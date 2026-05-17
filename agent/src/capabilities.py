"""
Capability taxonomy — the structured vocabulary the classifier emits and the
pattern detector groups by.

Each capability is verb-led and namespaced. "automatable" is a hint for the
pattern detector / opportunity ranker; the actual automation_class on an
opportunity is determined at detection time based on connected tools.

KEEP IN SYNC with dashboard/src/lib/capabilities.ts.
"""

CAPABILITY_TAXONOMY: list[dict] = [
    # ----- data movement & transformation -----
    {"id": "data.transfer.between_apps",   "label": "Transfer data between apps",          "automatable": True},
    {"id": "data.entry.form_fill",         "label": "Fill in a form or record",            "automatable": True},
    {"id": "data.entry.bulk",              "label": "Bulk / repetitive data entry",        "automatable": True},
    {"id": "data.lookup.record",           "label": "Look up a record by id or name",      "automatable": True},
    {"id": "data.lookup.reference",        "label": "Consult a reference (price, policy)", "automatable": True},
    {"id": "data.extract.document",        "label": "Extract fields from a document",      "automatable": True},
    {"id": "data.aggregate",               "label": "Sum, count, or summarize data",       "automatable": True},
    {"id": "data.transform.format",        "label": "Reformat values (dates, names, etc)", "automatable": True},
    {"id": "data.validate",                "label": "Check data against rules",            "automatable": True},
    {"id": "data.dedupe",                  "label": "Identify or remove duplicates",       "automatable": True},

    # ----- communication -----
    {"id": "communication.send.email",     "label": "Send an email",                       "automatable": True},
    {"id": "communication.send.sms",       "label": "Send a text/SMS",                     "automatable": True},
    {"id": "communication.send.chat",      "label": "Send a chat message",                 "automatable": True},
    {"id": "communication.send.notification","label": "Send a push/in-app notification",   "automatable": True},
    {"id": "communication.reply.routine",  "label": "Reply to a routine inquiry",          "automatable": True},
    {"id": "communication.reply.custom",   "label": "Compose a custom reply",              "automatable": False},
    {"id": "communication.triage.inbox",   "label": "Sort or route incoming messages",     "automatable": True},
    {"id": "communication.call.outbound",  "label": "Make an outbound phone call",         "automatable": False},
    {"id": "communication.call.inbound",   "label": "Take an inbound phone call",          "automatable": False},

    # ----- documents -----
    {"id": "document.create",              "label": "Create a new document",               "automatable": False},
    {"id": "document.template_fill",       "label": "Fill a templated document",           "automatable": True},
    {"id": "document.review",              "label": "Read or review a document",           "automatable": False},
    {"id": "document.sign",                "label": "Sign a document",                     "automatable": False},
    {"id": "document.convert",             "label": "Convert a document format",           "automatable": True},

    # ----- workflow -----
    {"id": "workflow.assign",              "label": "Assign a task to a person/queue",     "automatable": True},
    {"id": "workflow.schedule",            "label": "Place an item on a calendar",         "automatable": True},
    {"id": "workflow.approve",             "label": "Approve or reject an item",           "automatable": False},
    {"id": "workflow.route",               "label": "Route an item to the next step",      "automatable": True},
    {"id": "workflow.track_status",        "label": "Check the status of an item",         "automatable": True},
    {"id": "workflow.escalate",            "label": "Flag an exception or escalation",     "automatable": True},

    # ----- search -----
    {"id": "search.contact",               "label": "Look up a person's contact info",     "automatable": True},
    {"id": "search.knowledge",             "label": "Search documentation or policy",      "automatable": True},
    {"id": "search.web",                   "label": "General web search",                  "automatable": False},

    # ----- monitoring -----
    {"id": "monitoring.check_routine",     "label": "Periodically check a dashboard",      "automatable": True},
    {"id": "monitoring.alert_respond",     "label": "Respond to an automated alert",       "automatable": True},

    # ----- reporting -----
    {"id": "reporting.generate",           "label": "Generate or compile a report",        "automatable": True},
    {"id": "reporting.review",             "label": "Read or analyze a report",            "automatable": False},

    # ----- meetings -----
    {"id": "meeting.attend",               "label": "Actively attending a meeting/call",   "automatable": False},
    {"id": "meeting.prepare",              "label": "Prepare materials for a meeting",     "automatable": False},
    {"id": "meeting.followup",             "label": "Post-meeting notes / action items",   "automatable": True},

    # ----- admin -----
    {"id": "admin.invoice.create",         "label": "Create an invoice or bill",           "automatable": True},
    {"id": "admin.invoice.process",        "label": "Process incoming invoices",           "automatable": True},
    {"id": "admin.payroll.process",        "label": "Payroll processing",                  "automatable": True},
    {"id": "admin.timekeeping",            "label": "Enter or review time/attendance",     "automatable": True},
    {"id": "admin.expense.entry",          "label": "Submit or review expenses",           "automatable": True},
    {"id": "admin.compliance.check",       "label": "Compliance review or attestation",    "automatable": True},
    {"id": "admin.onboarding",             "label": "Onboarding tasks",                    "automatable": True},
    {"id": "admin.offboarding",            "label": "Offboarding tasks",                   "automatable": True},

    # ----- non-work / opt-out states -----
    {"id": "idle",                         "label": "No active work detected",             "automatable": False},
    {"id": "break",                        "label": "On break / away from desk",           "automatable": False},
    {"id": "personal",                     "label": "Personal activity (exclude)",         "automatable": False},
    {"id": "unknown",                      "label": "Cannot classify",                     "automatable": False},
]

CAPABILITY_IDS: set[str] = {c["id"] for c in CAPABILITY_TAXONOMY}


def taxonomy_for_prompt() -> str:
    """Render the taxonomy as a compact list the LLM can consume."""
    lines = []
    for c in CAPABILITY_TAXONOMY:
        marker = "[AUTOMATABLE]" if c["automatable"] else ""
        lines.append(f"  {c['id']:42s} — {c['label']} {marker}".rstrip())
    return "\n".join(lines)
