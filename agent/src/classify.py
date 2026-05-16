import anthropic
import json
import os

_client = None
_client_key = None


def _get_client(api_key: str | None = None):
    global _client, _client_key
    key = api_key or os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY not provided to classify_snapshot")
    if _client is None or _client_key != key:
        _client = anthropic.Anthropic(api_key=key)
        _client_key = key
    return _client

SYSTEM_PROMPT = """You are an expert business process analyst embedded in a workflow monitoring system called Groundwork.

Your job is to analyze screenshots and contextual signals from admin employees and classify exactly what task they are performing at this moment.

You have deep knowledge of home care business operations including:
- Scheduling and staffing workflows (WellSky, ClearCare, HHAeXchange)
- Billing and invoicing (WellSky, QuickBooks, Waystar)
- Caregiver HR and onboarding
- Client intake and care planning
- Authorization and compliance workflows
- Family and client communication
- Payroll processing
- Reporting and documentation

CRITICAL RULES:
1. Be SPECIFIC — not "using WellSky" but "building a caregiver schedule for the week of [date]" or "processing a missed visit exception"
2. Use ALL context signals together — window title, URL, keystroke volume, idle time, previous tasks
3. If idle > 60 seconds and keystrokes = 0, classify as phone call, break, or meeting based on other signals
4. High keystrokes + copy/paste events = data entry workflow — flag as high automation potential
5. Always output valid JSON only — no preamble, no explanation, no markdown

TASK CATEGORIES:
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
- Unknown"""

CLASSIFICATION_PROMPT = """Analyze this context bundle and classify exactly what task this employee is performing right now.

CONTEXT:
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

The screenshot is attached.

Respond with ONLY this JSON structure, no other text:
{{
  "task": "specific description of exactly what they are doing right now",
  "category": "one of the task categories listed",
  "software": "primary software application in use or null",
  "activity_level": "high | medium | low | idle",
  "confidence": 0-100,
  "automation_potential": "high | medium | low | none",
  "workflow_step": "where in the workflow this step sits, or null",
  "trigger": "what likely triggered this task, or null",
  "reasoning": "2-3 sentences explaining your classification based on the signals",
  "flags": []
}}

For the flags array, include any of these that apply:
- "repetitive_data_entry" — high keystrokes + copy/paste suggest manual data entry
- "possible_phone_call" — idle screen but likely on a call
- "error_correction" — signs of fixing a mistake
- "high_value_automation" — this exact task could be automated with high ROI
- "training_opportunity" — task taking longer than expected
- "anomaly" — unusual for this time of day or role"""


def classify_snapshot(snapshot: dict, api_key: str | None = None) -> dict:
    """
    Send a context snapshot to Claude Vision and get a task classification.
    Returns parsed JSON classification dict.

    api_key: Anthropic API key. If omitted, falls back to ANTHROPIC_API_KEY env var.
    """
    client = _get_client(api_key)

    previous_tasks_str = "\n".join([
        f"  - {t}" for t in snapshot.get("previous_tasks", [])
    ]) or "  None yet"

    prompt = CLASSIFICATION_PROMPT.format(
        timestamp=snapshot["timestamp"],
        active_window=snapshot["active_window"] or "Unknown",
        active_url=snapshot["active_url"] or "Not a browser",
        keystrokes=snapshot["keystrokes_last_90s"],
        clicks=snapshot["mouse_clicks_last_90s"],
        pastes=snapshot["copy_paste_events_last_90s"],
        idle_seconds=snapshot["idle_seconds"],
        is_idle=snapshot["is_idle"],
        previous_tasks=previous_tasks_str,
    )

    response = client.messages.create(
        model="claude-opus-4-5",
        max_tokens=1000,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": snapshot["screenshot_b64"],
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
    )

    raw = response.content[0].text.strip()
    
    # Strip markdown code fences if present
    if raw.startswith("```"):
        lines = raw.split("\n")
        raw = "\n".join(lines[1:-1])
    
    result = json.loads(raw)
    result["timestamp"] = snapshot["timestamp"]
    result["active_window"] = snapshot["active_window"]
    result["active_url"] = snapshot["active_url"]
    result["keystrokes"] = snapshot["keystrokes_last_90s"]
    result["idle_seconds"] = snapshot["idle_seconds"]
    
    return result


def print_classification(result: dict):
    """Pretty print a classification result to terminal."""
    confidence_bar = "█" * (result["confidence"] // 10) + "░" * (10 - result["confidence"] // 10)
    
    print("\n" + "="*60)
    print(f"  {result['timestamp']}")
    print("="*60)
    print(f"  TASK:       {result['task']}")
    print(f"  CATEGORY:   {result['category']}")
    print(f"  SOFTWARE:   {result.get('software', 'N/A')}")
    print(f"  ACTIVITY:   {result['activity_level'].upper()}")
    print(f"  CONFIDENCE: {confidence_bar} {result['confidence']}%")
    print(f"  AUTOMATION: {result['automation_potential'].upper()} potential")
    if result.get("flags"):
        print(f"  FLAGS:      {', '.join(result['flags'])}")
    print(f"  REASONING:  {result['reasoning']}")
    print("="*60)


if __name__ == "__main__":
    from capture import build_context_snapshot, start_input_listeners
    import time
    
    print("Groundwork — v0.1 Classification Test")
    print("Starting input listeners...")
    start_input_listeners()
    time.sleep(1)
    
    print("Capturing snapshot...")
    snapshot = build_context_snapshot()
    
    print("Sending to Claude Vision...")
    result = classify_snapshot(snapshot)
    
    print_classification(result)
    
    print("\nRaw JSON:")
    print(json.dumps(result, indent=2))
