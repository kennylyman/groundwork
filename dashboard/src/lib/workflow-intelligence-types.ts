/**
 * Shared types for the Workflow Intelligence Map.
 *
 * Used by:
 *   - /api/workflow-intelligence (server-side aggregation + Claude clustering)
 *   - WorkflowIntelligenceMap (D3 visualization, client)
 *   - WorkflowClusterPanel (cluster detail side panel, client)
 *
 * The shape is deliberately denormalized: the API does all the joins and
 * the client renders the result directly. Keeps the D3 setup logic
 * focused on layout rather than data wrangling.
 */

export type AutomationPotential = 'high' | 'medium' | 'low' | 'none'
export type AutomationClass = 'A' | 'B' | 'C'

export type EmployeeNode = {
  id: string
  name: string
  role: string | null
  initials: string
  /** Total captures in window. Drives node radius. */
  total_capture_count: number
  /** Subset where automation_potential != 'none'. */
  automatable_capture_count: number
  top_tasks: Array<{
    task: string
    count: number
    automation_potential: AutomationPotential
    category: string | null
  }>
}

export type TaskNode = {
  id: string
  employee_id: string
  label: string
  /** Per-employee capture count for this task. Drives radius. */
  frequency: number
  automation_potential: AutomationPotential
  category: string | null
}

export type Connection = {
  /** Employee node ids. */
  source_employee_id: string
  target_employee_id: string
  /** 0..1. Stroke thickness mapping. */
  weight: number
  /** Capability ids the two employees both share via at least one cluster. */
  shared_capabilities: string[]
}

export type ClusterMatchingTask = {
  employee_id: string
  task: string
  similarity: number
}

export type WorkflowCluster = {
  id: string
  label: string
  description: string
  employee_ids: string[]
  task_node_ids: string[]
  capabilities: string[]
  weekly_minutes: number
  annual_cost: number
  annual_savings: number
  confidence: number
  automation_class: AutomationClass
  matching_tasks: ClusterMatchingTask[]
}

export type WorkflowIntelligencePayload = {
  business_id: string
  generated_at: string
  cache_age_seconds: number
  cache_hit: boolean
  window_days: number
  /** Distinct categories present in the data — drives the filter dropdown. */
  categories: string[]
  employees: EmployeeNode[]
  task_nodes: TaskNode[]
  connections: Connection[]
  clusters: WorkflowCluster[]
  /** Total opportunity surfaced by clustering. Used for collapsed summary bar. */
  total_annual_savings: number
}
