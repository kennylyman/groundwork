"""
Per-capture classifier.

Two outputs that matter:
  1. capabilities[]  — structured machine-readable tags (the pattern detector
     consumes these to build automation opportunities)
  2. category/task   — human-readable rollups (the dashboard displays these)

The system prompt is large (~1.5k tokens with the full capability taxonomy)
so we mark it cache-eligible — Anthropic's prompt caching amortizes that cost
across captures within a few minutes.

A second-pass call fires when confidence on the first pass is below CONF_BAR.
That's a cheap quality lever for the hard captures and is a no-op for clean
ones.
"""

import anthropic
import json
import os

from capabilities import CAPABILITY_IDS, taxonomy_for_prompt

_client = None
_client_key = None

# Confidence floor for accepting a first-pass classification. Below this we
# re-run with a stronger reasoning request.
CONF_BAR = 60


def _get_client(api_key: str | None = None):
    global _client, _client_key
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not provided to classify_snapshot")
    if _client is None or _client_key != key:
        _client = anthropic.Anthropic(api_key=key)
        _client_key = key
    return _client


# ---------- Prompt construction ----------

SYSTEM_PROMPT_TEMPLATE = """You are an expert business process analyst embedded in a workflow monitoring system called Groundwork.

You analyze screenshots and contextual signals from employees and produce TWO outputs from each capture:

(1) STRUCTURED CAPABILITY TAGS — the machine-readable layer. These are the verbs an automation could perform. Use ONLY ids from the taxonomy below. Each tag carries optional parameters that describe the specific instance (which tool, which fields, which destination).

(2) HUMAN-READABLE ROLLUP — the existing task / category / reasoning summary. This is what the dashboard shows to people.

CAPABILITY TAXONOMY (use these exact ids — never invent new ones):
{taxonomy}

Tags marked [AUTOMATABLE] are the high-leverage ones. The goal of this product is to surface automation opportunities, so DO NOT be conservative: if a capture shows any plausibly repeatable automatable action, tag it. False positives in tagging are recoverable downstream; missed tags are not.

TASK CATEGORIES (for the human-readable rollup):
- Schedule Management
- Billing and Invoicing
- Caregiver HR and Onboarding
- Client Intake and Care Planning
- Authorization and Compliance
- Family and Client Communication
- Internal Communication
- Payroll Processing
- Reporting and Documentation
- Problem Resolution
- Meeting or Phone Call
- Break or Idle
- Unknown

BUSINESS CONTEXT:
{business_context}

ROLE CONTEXT (for this employee):
{role_context}

OUTPUT FORMAT — valid JSON only, no preamble, no markdown fences:
{{
  "capabilities": [
    {{
      "id": "data.transfer.between_apps",
      "params": {{ "source": "WellSky", "destination": "SMS", "fields": ["shift_time", "caregiver_name"] }},
      "confidence": 92
    }}
  ],
  "task": "specific human description of exactly what they are doing right now",
  "category": "one of the task categories above",
  "software": "primary software application in use, or null",
  "activity_level": "high | medium | low | idle",
  "confidence": 0-100,
  "automation_potential": "high | medium | low | none",
  "workflow_step": "where in a larger workflow this step sits, or null",
  "trigger": "what likely triggered this task, or null",
  "reasoning": "2-3 sentences explaining your classification based on the signals",
  "flags": []
}}

Rules:
- capabilities[] may be empty for genuinely idle/break captures, but only then.
- If you tag any [AUTOMATABLE] capability, automation_potential MUST be at least "medium" (raise to "high" if input rates show clear repetition).
- params should reference specific tools / fields visible in the capture — vague params ("source": "an app") add no value.
- For the flags array, include any of: "repetitive_data_entry", "possible_phone_call", "error_correction", "high_value_automation", "training_opportunity", "anomaly".
"""

CLASSIFICATION_PROMPT_TEMPLATE = """Analyze this capture and produce the JSON specified.

CONTEXT SIGNALS:
Timestamp: {timestamp}
Active window: {active_window}
Active URL: {active_url}
Keystrokes in last 90 seconds: {keystrokes}
Mouse clicks in last 90 seconds: {clicks}
Copy/paste events in last 90 seconds: {pastes}
Idle seconds: {idle_seconds}
Is idle: {is_idle}

Recent task history (most recent last):
{previous_tasks}

The screenshot is attached. Respond with ONLY the JSON.
"""

SECOND_PASS_NUDGE = """The previous classification was below the confidence threshold. Look again, more carefully:

1. Re-examine the screenshot. What software is open? What's the user actively doing — typing, reading, clicking through a list?
2. Cross-check against the input signals. High keystrokes + paste events almost always indicate data transfer. Long idle with the screen unchanged indicates a phone call or break.
3. Be more specific in capabilities[] params. Concrete tool and field names beat vague ones every time.
4. Lower your confidence on the rollup fields only if you genuinely can't tell — don't reflexively raise it.

Return the same JSON shape.
"""


def _format_business_context(ctx: dict | None) -> str:
    """Render business context (from Phase 2 onboarding agent) into the prompt.

    Phase 1 ships with this empty — placeholder is fine and tells the model
    to fall back on general SMB priors.
    """
    if not ctx:
        return "  (Business context not yet captured. Use general SMB priors.)"
    parts = []
    for k in ("industry", "sub_industry", "size_band", "tool_stack", "vocab", "pain_points"):
        v = ctx.get(k)
        if v:
            parts.append(f"  {k}: {v if isinstance(v, str) else json.dumps(v)}")
    return "\n".join(parts) if parts else "  (Business context partially captured.)"


def _format_role_context(ctx: dict | None) -> str:
    """Render role context (from Phase 3 Role Discovery) into the prompt."""
    if not ctx:
        return "  (Role context not yet captured. Use generic-employee priors.)"
    parts = []
    if ctx.get("observed_role"):
        parts.append(f"  observed_role: {ctx['observed_role']}")
    if ctx.get("primary_workflows"):
        parts.append(f"  primary_workflows: {ctx['primary_workflows']}")
    if ctx.get("activity_clusters"):
        labels = [c.get("label") for c in ctx["activity_clusters"] if c.get("label")]
        if labels:
            parts.append(f"  activity_clusters: {labels}")
    return "\n".join(parts) if parts else "  (Role context partially captured.)"


def _build_system_prompt(business_context: dict | None, role_context: dict | None) -> str:
    return SYSTEM_PROMPT_TEMPLATE.format(
        taxonomy=taxonomy_for_prompt(),
        business_context=_format_business_context(business_context),
        role_context=_format_role_context(role_context),
    )


def _build_user_prompt(snapshot: dict, previous_tasks_str: str) -> str:
    return CLASSIFICATION_PROMPT_TEMPLATE.format(
        timestamp=snapshot.get("timestamp", ""),
        active_window=snapshot.get("active_window") or "Unknown",
        active_url=snapshot.get("active_url") or "Not a browser",
        keystrokes=snapshot.get("keystrokes_last_90s", 0),
        clicks=snapshot.get("mouse_clicks_last_90s", 0),
        pastes=snapshot.get("copy_paste_events_last_90s", 0),
        idle_seconds=snapshot.get("idle_seconds", 0),
        is_idle=snapshot.get("is_idle", False),
        previous_tasks=previous_tasks_str,
    )


# ---------- Result parsing + sanitization ----------

def _parse_response_text(raw: str) -> dict:
    s = raw.strip()
    if s.startswith("```"):
        lines = s.split("\n")
        s = "\n".join(lines[1:-1])
    return json.loads(s)


def _sanitize_capabilities(caps: list | None) -> list:
    """Drop tags with unknown ids; normalize the shape."""
    if not isinstance(caps, list):
        return []
    out = []
    for c in caps:
        if not isinstance(c, dict):
            continue
        cap_id = c.get("id")
        if cap_id not in CAPABILITY_IDS:
            continue
        out.append({
            "id": cap_id,
            "params": c.get("params") or {},
            "confidence": int(c.get("confidence") or 0),
        })
    return out


# ---------- Classification entry point ----------

def _call_model(
    client,
    system_prompt: str,
    user_prompt: str,
    screenshot_b64: str,
) -> dict:
    """Single call to Claude with prompt caching enabled on the system block."""
    response = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1200,
        system=[
            {
                "type": "text",
                "text": system_prompt,
                # Caches the taxonomy + context block. After the first call
                # of the day, subsequent classifications read this from cache.
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": screenshot_b64,
                        },
                    },
                    {"type": "text", "text": user_prompt},
                ],
            }
        ],
    )
    return _parse_response_text(response.content[0].text)


def classify_snapshot(
    snapshot: dict,
    api_key: str | None = None,
    business_context: dict | None = None,
    role_context: dict | None = None,
) -> dict:
    """
    Classify a capture into structured capabilities + a human-readable rollup.

    business_context / role_context are the Phase 2 / Phase 3 context objects.
    In Phase 1 they are typically None — the system prompt explains to the
    model to fall back on general priors.
    """
    client = _get_client(api_key)

    previous_tasks_str = "\n".join(
        [f"  - {t}" for t in snapshot.get("previous_tasks", [])]
    ) or "  None yet"

    system_prompt = _build_system_prompt(business_context, role_context)
    user_prompt = _build_user_prompt(snapshot, previous_tasks_str)
    screenshot_b64 = snapshot["screenshot_b64"]

    # First pass
    result = _call_model(client, system_prompt, user_prompt, screenshot_b64)

    # Second pass when first-pass confidence is shaky. Idle/break captures
    # legitimately have low confidence about *which kind of nothing* is
    # happening; don't burn a second call on them.
    if (
        result.get("confidence", 0) < CONF_BAR
        and result.get("category") not in ("Break or Idle", "Unknown")
    ):
        retry_prompt = user_prompt + "\n\n" + SECOND_PASS_NUDGE
        try:
            second = _call_model(client, system_prompt, retry_prompt, screenshot_b64)
            if second.get("confidence", 0) >= result.get("confidence", 0):
                result = second
        except Exception:
            # If the second pass blows up, keep the first-pass result.
            pass

    # Normalize machine-readable layer
    result["capabilities"] = _sanitize_capabilities(result.get("capabilities"))

    # Enrich with snapshot signals so transmit.py has them in one place
    result["timestamp"] = snapshot.get("timestamp", "")
    result["active_window"] = snapshot.get("active_window")
    result["active_url"] = snapshot.get("active_url")
    result["keystrokes"] = snapshot.get("keystrokes_last_90s", 0)
    result["idle_seconds"] = snapshot.get("idle_seconds", 0)

    return result


# ---------- CLI helper ----------

def print_classification(result: dict):
    confidence_bar = "█" * (result["confidence"] // 10) + "░" * (10 - result["confidence"] // 10)
    print("\n" + "=" * 60)
    print(f"  {result.get('timestamp', '')}")
    print("=" * 60)
    print(f"  TASK:        {result['task']}")
    print(f"  CATEGORY:    {result['category']}")
    print(f"  SOFTWARE:    {result.get('software', 'N/A')}")
    print(f"  ACTIVITY:    {result['activity_level'].upper()}")
    print(f"  CONFIDENCE:  {confidence_bar} {result['confidence']}%")
    print(f"  AUTOMATION:  {result['automation_potential'].upper()} potential")
    if result.get("capabilities"):
        print(f"  CAPABILITIES:")
        for c in result["capabilities"]:
            print(f"    - {c['id']}  {json.dumps(c.get('params') or {})}")
    if result.get("flags"):
        print(f"  FLAGS:       {', '.join(result['flags'])}")
    print(f"  REASONING:   {result['reasoning']}")
    print("=" * 60)


if __name__ == "__main__":
    from capture import build_context_snapshot, start_input_listeners
    import time

    print("Groundwork — capability-tagged classification test")
    start_input_listeners()
    time.sleep(1)

    snapshot = build_context_snapshot()
    result = classify_snapshot(snapshot)
    print_classification(result)
    print("\nRaw JSON:")
    print(json.dumps(result, indent=2))
