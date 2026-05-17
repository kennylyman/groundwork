/**
 * Capability taxonomy — MUST stay in sync with agent/src/capabilities.py.
 *
 * Used by:
 *   - the opportunity detector (group/dedupe by capability id, score by automatable)
 *   - the dashboard (show human-readable labels for opportunity rows)
 */

export type Capability = {
  id: string
  label: string
  automatable: boolean
}

export const CAPABILITY_TAXONOMY: Capability[] = [
  // ----- data movement & transformation -----
  { id: 'data.transfer.between_apps',   label: 'Transfer data between apps',          automatable: true },
  { id: 'data.entry.form_fill',         label: 'Fill in a form or record',            automatable: true },
  { id: 'data.entry.bulk',              label: 'Bulk / repetitive data entry',        automatable: true },
  { id: 'data.lookup.record',           label: 'Look up a record by id or name',      automatable: true },
  { id: 'data.lookup.reference',        label: 'Consult a reference (price, policy)', automatable: true },
  { id: 'data.extract.document',        label: 'Extract fields from a document',      automatable: true },
  { id: 'data.aggregate',               label: 'Sum, count, or summarize data',       automatable: true },
  { id: 'data.transform.format',        label: 'Reformat values (dates, names, etc)', automatable: true },
  { id: 'data.validate',                label: 'Check data against rules',            automatable: true },
  { id: 'data.dedupe',                  label: 'Identify or remove duplicates',       automatable: true },

  // ----- communication -----
  { id: 'communication.send.email',         label: 'Send an email',                   automatable: true },
  { id: 'communication.send.sms',           label: 'Send a text/SMS',                 automatable: true },
  { id: 'communication.send.chat',          label: 'Send a chat message',             automatable: true },
  { id: 'communication.send.notification',  label: 'Send a push/in-app notification', automatable: true },
  { id: 'communication.reply.routine',      label: 'Reply to a routine inquiry',      automatable: true },
  { id: 'communication.reply.custom',       label: 'Compose a custom reply',          automatable: false },
  { id: 'communication.triage.inbox',       label: 'Sort or route incoming messages', automatable: true },
  { id: 'communication.call.outbound',      label: 'Make an outbound phone call',     automatable: false },
  { id: 'communication.call.inbound',       label: 'Take an inbound phone call',      automatable: false },

  // ----- documents -----
  { id: 'document.create',          label: 'Create a new document',     automatable: false },
  { id: 'document.template_fill',   label: 'Fill a templated document', automatable: true },
  { id: 'document.review',          label: 'Read or review a document', automatable: false },
  { id: 'document.sign',            label: 'Sign a document',           automatable: false },
  { id: 'document.convert',         label: 'Convert a document format', automatable: true },

  // ----- workflow -----
  { id: 'workflow.assign',         label: 'Assign a task to a person/queue', automatable: true },
  { id: 'workflow.schedule',       label: 'Place an item on a calendar',     automatable: true },
  { id: 'workflow.approve',        label: 'Approve or reject an item',       automatable: false },
  { id: 'workflow.route',          label: 'Route an item to the next step',  automatable: true },
  { id: 'workflow.track_status',   label: 'Check the status of an item',     automatable: true },
  { id: 'workflow.escalate',       label: 'Flag an exception or escalation', automatable: true },

  // ----- search -----
  { id: 'search.contact',     label: "Look up a person's contact info",   automatable: true },
  { id: 'search.knowledge',   label: 'Search documentation or policy',    automatable: true },
  { id: 'search.web',         label: 'General web search',                automatable: false },

  // ----- monitoring -----
  { id: 'monitoring.check_routine',  label: 'Periodically check a dashboard',  automatable: true },
  { id: 'monitoring.alert_respond',  label: 'Respond to an automated alert',   automatable: true },

  // ----- reporting -----
  { id: 'reporting.generate',  label: 'Generate or compile a report',  automatable: true },
  { id: 'reporting.review',    label: 'Read or analyze a report',      automatable: false },

  // ----- meetings -----
  { id: 'meeting.attend',     label: 'Actively attending a meeting/call',   automatable: false },
  { id: 'meeting.prepare',    label: 'Prepare materials for a meeting',     automatable: false },
  { id: 'meeting.followup',   label: 'Post-meeting notes / action items',   automatable: true },

  // ----- admin -----
  { id: 'admin.invoice.create',     label: 'Create an invoice or bill',      automatable: true },
  { id: 'admin.invoice.process',    label: 'Process incoming invoices',      automatable: true },
  { id: 'admin.payroll.process',    label: 'Payroll processing',             automatable: true },
  { id: 'admin.timekeeping',        label: 'Enter or review time/attendance', automatable: true },
  { id: 'admin.expense.entry',      label: 'Submit or review expenses',      automatable: true },
  { id: 'admin.compliance.check',   label: 'Compliance review or attestation', automatable: true },
  { id: 'admin.onboarding',         label: 'Onboarding tasks',               automatable: true },
  { id: 'admin.offboarding',        label: 'Offboarding tasks',              automatable: true },

  // ----- non-work / opt-out -----
  { id: 'idle',     label: 'No active work detected',         automatable: false },
  { id: 'break',    label: 'On break / away from desk',       automatable: false },
  { id: 'personal', label: 'Personal activity (exclude)',     automatable: false },
  { id: 'unknown',  label: 'Cannot classify',                 automatable: false },
]

export const CAPABILITY_BY_ID: Record<string, Capability> = Object.fromEntries(
  CAPABILITY_TAXONOMY.map((c) => [c.id, c])
)

export function capabilityLabel(id: string): string {
  return CAPABILITY_BY_ID[id]?.label ?? id
}
