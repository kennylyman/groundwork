/**
 * Workflow Intelligence Map.
 *
 * Force-directed graph of:
 *   - Employee nodes (large, with initials, pulsing)
 *   - Task nodes orbiting their employee
 *   - Connection lines between employees who share automatable work
 *   - Glowing cluster regions around automation opportunities
 *
 * Architecture:
 *   - Data fetched from /api/workflow-intelligence (1hr server cache,
 *     5min client poll).
 *   - D3 force simulation runs entirely client-side. Pauses when the
 *     tab is hidden.
 *   - Hovers and clicks update React state, which drives the tooltip
 *     and the side panel (lifted up to the parent).
 *
 * Performance notes:
 *   - Cap is 50 nodes total. The forceCollide + forceLink combination
 *     stays responsive well below that.
 *   - Cluster region paths are recomputed on every tick. Cheap — a
 *     polygon hull over 3-8 points.
 *   - On data refresh the simulation reheats to alpha=0.5 and re-settles,
 *     so node positions transition smoothly.
 */
'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import * as d3 from 'd3'
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import type {
  WorkflowIntelligencePayload,
  WorkflowCluster,
  EmployeeNode,
  TaskNode,
} from '@/lib/workflow-intelligence-types'
import { WorkflowClusterPanel } from './WorkflowClusterPanel'

// ----- Visual tunables ---------------------------------------------------

const BG_COLOR = '#0a0e1a'
const EMPLOYEE_FILL = 'url(#employeeGradient)'
const EMPLOYEE_STROKE = '#a5b4fc'
const TASK_STROKE_DEFAULT = '#475569'
const TASK_FILL_DEFAULT = '#1e293b'
const TASK_FILL_HIGH = '#f59e0b'
const TASK_FILL_MED = '#0ea5e9'
const CONNECTION_STROKE = '#cbd5e1'
const CLUSTER_FILL = '#f59e0b'
const HEIGHT_EXPANDED = 500

const POLL_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

// ----- Internal node/link types -----------------------------------------

type SimEmployeeNode = d3.SimulationNodeDatum & {
  id: string
  kind: 'employee'
  data: EmployeeNode
  radius: number
}
type SimTaskNode = d3.SimulationNodeDatum & {
  id: string
  kind: 'task'
  data: TaskNode
  radius: number
}
type SimNode = SimEmployeeNode | SimTaskNode

type SimLink = d3.SimulationLinkDatum<SimNode> & {
  kind: 'orbit' | 'connection'
  weight: number
}

// ----- Helpers ----------------------------------------------------------

function employeeRadius(emp: EmployeeNode, maxCount: number): number {
  // Scale from 18 (lowest activity) to 34 (highest).
  if (!maxCount) return 24
  const t = Math.min(1, Math.max(0, emp.total_capture_count / maxCount))
  return 18 + t * 16
}

function taskRadius(task: TaskNode, maxFreq: number): number {
  if (!maxFreq) return 6
  const t = Math.min(1, Math.max(0, task.frequency / maxFreq))
  return 5 + t * 7
}

function taskFill(task: TaskNode): string {
  if (task.automation_potential === 'high') return TASK_FILL_HIGH
  if (task.automation_potential === 'medium') return TASK_FILL_MED
  return TASK_FILL_DEFAULT
}

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US')
}

function fmtAge(seconds: number | null): string {
  if (seconds === null) return ''
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  return `${Math.floor(seconds / 3600)}h ago`
}

// ----- Component --------------------------------------------------------

type HoverState =
  | { kind: 'employee'; node: EmployeeNode; x: number; y: number }
  | { kind: 'task'; node: TaskNode; x: number; y: number }
  | { kind: 'cluster'; cluster: WorkflowCluster; x: number; y: number }
  | null

export function WorkflowIntelligenceMap() {
  const [data, setData] = useState<WorkflowIntelligencePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [hover, setHover] = useState<HoverState>(null)
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null)
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterAutomation, setFilterAutomation] = useState<string>('all')

  // Stable poll: refresh every 5 minutes. The server side has its own
  // 1-hour cache so most polls are cheap cache hits.
  const load = useCallback(async (force = false) => {
    try {
      setError(null)
      const url = '/api/workflow-intelligence' + (force ? '?refresh=1' : '')
      const res = await fetch(url, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setData(body as WorkflowIntelligencePayload)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown error')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    const t = setInterval(() => void load(false), POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [load])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    void load(true)
  }, [load])

  // Filter data client-side. Filters affect which task nodes are
  // visible and which clusters are highlighted. Employees always stay
  // visible so the map doesn't lose its anchor structure.
  const filtered = useMemo(() => {
    if (!data) return null
    const taskNodes = data.task_nodes.filter((t) => {
      if (filterCategory !== 'all' && t.category !== filterCategory) return false
      if (filterAutomation !== 'all' && t.automation_potential !== filterAutomation) {
        return false
      }
      return true
    })
    const visibleTaskIds = new Set(taskNodes.map((t) => t.id))
    const clusters = data.clusters.filter((c) =>
      c.task_node_ids.some((id) => visibleTaskIds.has(id))
    )
    return { ...data, task_nodes: taskNodes, clusters }
  }, [data, filterCategory, filterAutomation])

  const selectedCluster = useMemo(
    () => filtered?.clusters.find((c) => c.id === selectedClusterId) ?? null,
    [filtered, selectedClusterId]
  )

  if (loading && !data) {
    return (
      <div
        className="rounded-2xl border border-gray-800/50 flex items-center justify-center"
        style={{ background: BG_COLOR, height: HEIGHT_EXPANDED }}
      >
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin" />
          <p className="text-sm">Loading workflow intelligence...</p>
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div
        className="rounded-2xl border border-red-900/40 flex items-center justify-center"
        style={{ background: BG_COLOR, height: HEIGHT_EXPANDED }}
      >
        <div className="flex flex-col items-center gap-3 text-red-300 max-w-sm text-center">
          <AlertCircle className="w-5 h-5" />
          <p className="text-sm font-medium">Workflow intelligence unavailable</p>
          <p className="text-xs text-red-400/80">{error}</p>
          <button
            type="button"
            onClick={onRefresh}
            className="text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 hover:bg-red-500/20"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  const hasContent = !!filtered && filtered.employees.length > 0

  if (collapsed) {
    return (
      <CollapsedBar
        data={filtered}
        onExpand={() => setCollapsed(false)}
      />
    )
  }

  return (
    <div
      className="relative rounded-2xl border border-gray-800/50 overflow-hidden"
      style={{ background: BG_COLOR }}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-start justify-between gap-4 p-4 pointer-events-none">
        <div className="pointer-events-auto">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-indigo-300/80">
            <Sparkles className="w-3 h-3" />
            Workflow Intelligence
          </div>
          <h2 className="text-base font-semibold text-white mt-1">
            How your team's work fits together
          </h2>
          {filtered && filtered.total_annual_savings > 0 && (
            <p className="text-xs text-amber-300/90 mt-1">
              {filtered.clusters.length} automation cluster
              {filtered.clusters.length === 1 ? '' : 's'} detected ·{' '}
              <span className="font-semibold">
                {fmtMoney(filtered.total_annual_savings)}
              </span>{' '}
              combined opportunity / yr
            </p>
          )}
        </div>

        {/* Filters + collapse */}
        <div className="pointer-events-auto flex items-center gap-2">
          {hasContent && filtered.categories.length > 0 && (
            <DarkSelect
              value={filterCategory}
              onChange={setFilterCategory}
              options={[
                { value: 'all', label: 'All categories' },
                ...filtered.categories.map((c) => ({ value: c, label: c })),
              ]}
            />
          )}
          {hasContent && (
            <DarkSelect
              value={filterAutomation}
              onChange={setFilterAutomation}
              options={[
                { value: 'all', label: 'All automation' },
                { value: 'high', label: 'High potential' },
                { value: 'medium', label: 'Medium potential' },
                { value: 'low', label: 'Low potential' },
              ]}
            />
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10"
            title="Collapse"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Footer (cache age) */}
      {filtered && (
        <div className="absolute bottom-3 right-4 z-20 text-[10px] text-gray-500 pointer-events-none">
          updated {fmtAge(filtered.cache_age_seconds)}
        </div>
      )}

      {/* The graph */}
      {hasContent ? (
        <ForceGraph
          data={filtered}
          height={HEIGHT_EXPANDED}
          setHover={setHover}
          selectedEmployeeId={selectedEmployeeId}
          setSelectedEmployeeId={setSelectedEmployeeId}
          onClusterClick={(id) => setSelectedClusterId(id)}
        />
      ) : (
        <EmptyState height={HEIGHT_EXPANDED} />
      )}

      {/* Hover tooltip */}
      {hover && (
        <HoverTooltip hover={hover} />
      )}

      {/* Cluster detail side panel */}
      {selectedCluster && filtered && (
        <WorkflowClusterPanel
          cluster={selectedCluster}
          employees={filtered.employees}
          onClose={() => setSelectedClusterId(null)}
        />
      )}
    </div>
  )
}

// ----- The force graph (D3) ---------------------------------------------

type ForceGraphProps = {
  data: WorkflowIntelligencePayload
  height: number
  setHover: Dispatch<SetStateAction<HoverState>>
  selectedEmployeeId: string | null
  setSelectedEmployeeId: Dispatch<SetStateAction<string | null>>
  onClusterClick: (id: string) => void
}

function ForceGraph({
  data,
  height,
  setHover,
  selectedEmployeeId,
  setSelectedEmployeeId,
  onClusterClick,
}: ForceGraphProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null)
  const widthRef = useRef<number>(1000)
  const [width, setWidth] = useState<number>(1000)

  // Track container width for responsive sizing.
  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) {
        setWidth(w)
        widthRef.current = w
      }
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // Pause simulation when tab is hidden — keep CPU quiet on background tabs.
  useEffect(() => {
    function onVis() {
      const sim = simRef.current
      if (!sim) return
      if (document.hidden) {
        sim.stop()
      } else {
        sim.alphaTarget(0.05).restart()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Build / rebuild the simulation when data or width changes.
  useEffect(() => {
    if (!svgRef.current) return
    const svgEl = svgRef.current
    const svg = d3.select(svgEl)
    svg.selectAll('*').remove()

    const W = width
    const H = height

    // Defs: gradients + glow filters.
    const defs = svg.append('defs')

    const grad = defs
      .append('linearGradient')
      .attr('id', 'employeeGradient')
      .attr('x1', '0%').attr('y1', '0%').attr('x2', '100%').attr('y2', '100%')
    grad.append('stop').attr('offset', '0%').attr('stop-color', '#6366f1')
    grad.append('stop').attr('offset', '100%').attr('stop-color', '#8b5cf6')

    // Glow filter for cluster regions.
    const glow = defs
      .append('filter')
      .attr('id', 'clusterGlow')
      .attr('x', '-50%').attr('y', '-50%')
      .attr('width', '200%').attr('height', '200%')
    glow.append('feGaussianBlur').attr('stdDeviation', '8').attr('result', 'b')
    const merge = glow.append('feMerge')
    merge.append('feMergeNode').attr('in', 'b')
    merge.append('feMergeNode').attr('in', 'SourceGraphic')

    // ----- Build node + link arrays -----
    const maxEmpCount = Math.max(
      1,
      ...data.employees.map((e) => e.total_capture_count)
    )
    const maxTaskFreq = Math.max(
      1,
      ...data.task_nodes.map((t) => t.frequency)
    )

    const employeeNodes: SimEmployeeNode[] = data.employees.map((e) => ({
      id: e.id,
      kind: 'employee',
      data: e,
      radius: employeeRadius(e, maxEmpCount),
    }))
    const taskNodes: SimTaskNode[] = data.task_nodes.map((t) => ({
      id: t.id,
      kind: 'task',
      data: t,
      radius: taskRadius(t, maxTaskFreq),
    }))
    const allNodes: SimNode[] = [...employeeNodes, ...taskNodes]
    const nodeById = new Map<string, SimNode>(allNodes.map((n) => [n.id, n]))

    // Orbit links: each task → its employee. Short, strong.
    const orbitLinks: SimLink[] = []
    for (const t of taskNodes) {
      const target = nodeById.get(t.data.employee_id)
      if (!target) continue
      orbitLinks.push({
        source: target.id,
        target: t.id,
        kind: 'orbit',
        weight: 1,
      })
    }

    // Connection links: between employees who share clusters.
    const connectionLinks: SimLink[] = data.connections
      .filter(
        (c) =>
          nodeById.has(c.source_employee_id) &&
          nodeById.has(c.target_employee_id)
      )
      .map((c) => ({
        source: c.source_employee_id,
        target: c.target_employee_id,
        kind: 'connection' as const,
        weight: c.weight,
      }))

    const allLinks: SimLink[] = [...orbitLinks, ...connectionLinks]

    // ----- Simulation -----
    const sim = d3
      .forceSimulation<SimNode>(allNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(allLinks)
          .id((n) => (n as SimNode).id)
          .distance((l) => (l.kind === 'orbit' ? 50 : 180))
          .strength((l) => (l.kind === 'orbit' ? 0.9 : 0.15 * l.weight))
      )
      .force(
        'charge',
        d3.forceManyBody<SimNode>().strength((n) =>
          n.kind === 'employee' ? -400 : -80
        )
      )
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force(
        'collide',
        d3
          .forceCollide<SimNode>()
          .radius((n) => n.radius + 4)
          .strength(0.85)
      )
      .alpha(0.9)
      .alphaDecay(0.025)

    simRef.current = sim

    // ----- DOM layers (z-order: clusters, links, nodes, labels) -----
    const clustersLayer = svg.append('g').attr('class', 'clusters-layer')
    const linksLayer = svg.append('g').attr('class', 'links-layer')
    const nodesLayer = svg.append('g').attr('class', 'nodes-layer')

    // ----- Cluster regions (drawn behind everything) -----
    const clusterPaths = clustersLayer
      .selectAll<SVGPathElement, WorkflowCluster>('path')
      .data(data.clusters, (c) => c.id)
      .enter()
      .append('path')
      .attr('class', 'cluster-region')
      .attr('fill', CLUSTER_FILL)
      .attr('fill-opacity', 0.12)
      .attr('stroke', CLUSTER_FILL)
      .attr('stroke-opacity', 0.45)
      .attr('stroke-width', 1.5)
      .attr('filter', 'url(#clusterGlow)')
      .style('cursor', 'pointer')
      .on('mouseover', (event, cluster) => {
        d3.select(event.currentTarget as SVGPathElement)
          .attr('fill-opacity', 0.2)
          .attr('stroke-opacity', 0.7)
        const rect = svgEl.getBoundingClientRect()
        setHover({
          kind: 'cluster',
          cluster,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        })
      })
      .on('mousemove', (event) => {
        const rect = svgEl.getBoundingClientRect()
        setHover((prev) =>
          prev && prev.kind === 'cluster'
            ? { ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top }
            : prev
        )
      })
      .on('mouseout', (event) => {
        d3.select(event.currentTarget as SVGPathElement)
          .attr('fill-opacity', 0.12)
          .attr('stroke-opacity', 0.45)
        setHover(null)
      })
      .on('click', (_event, cluster) => {
        onClusterClick(cluster.id)
      })

    // ----- Connection lines -----
    const linkSelection = linksLayer
      .selectAll<SVGLineElement, SimLink>('line.connection')
      .data(connectionLinks)
      .enter()
      .append('line')
      .attr('class', 'connection')
      .attr('stroke', CONNECTION_STROKE)
      .attr('stroke-opacity', (d) => 0.15 + d.weight * 0.4)
      .attr('stroke-width', (d) => 0.8 + d.weight * 2.5)
      .attr('stroke-linecap', 'round')

    // ----- Employee nodes -----
    const empGroup = nodesLayer
      .selectAll<SVGGElement, SimEmployeeNode>('g.employee')
      .data(employeeNodes, (n) => n.id)
      .enter()
      .append('g')
      .attr('class', 'employee')
      .style('cursor', 'pointer')
      .on('mouseover', (event, n) => {
        const rect = svgEl.getBoundingClientRect()
        setHover({
          kind: 'employee',
          node: n.data,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        })
      })
      .on('mousemove', (event) => {
        const rect = svgEl.getBoundingClientRect()
        setHover((prev) =>
          prev && prev.kind === 'employee'
            ? { ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top }
            : prev
        )
      })
      .on('mouseout', () => setHover(null))
      .on('click', (_event, n) => {
        setSelectedEmployeeId(
          (prev) => (prev === n.id ? null : n.id)
        )
      })
      .call(
        d3
          .drag<SVGGElement, SimEmployeeNode>()
          .on('start', (event, n) => {
            if (!event.active) sim.alphaTarget(0.3).restart()
            n.fx = n.x
            n.fy = n.y
          })
          .on('drag', (event, n) => {
            n.fx = event.x
            n.fy = event.y
          })
          .on('end', (event, n) => {
            if (!event.active) sim.alphaTarget(0.05)
            n.fx = null
            n.fy = null
          })
      )

    empGroup
      .append('circle')
      .attr('class', 'pulse')
      .attr('r', (n) => n.radius + 6)
      .attr('fill', '#6366f1')
      .attr('fill-opacity', 0.15)
    empGroup
      .append('circle')
      .attr('class', 'core')
      .attr('r', (n) => n.radius)
      .attr('fill', EMPLOYEE_FILL)
      .attr('stroke', EMPLOYEE_STROKE)
      .attr('stroke-width', 1.5)
    empGroup
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', '#fff')
      .attr('font-size', (n) => Math.max(11, n.radius * 0.55))
      .attr('font-weight', 600)
      .attr('pointer-events', 'none')
      .text((n) => n.data.initials)

    // ----- Task nodes -----
    const taskGroup = nodesLayer
      .selectAll<SVGCircleElement, SimTaskNode>('circle.task')
      .data(taskNodes, (n) => n.id)
      .enter()
      .append('circle')
      .attr('class', 'task')
      .attr('r', (n) => n.radius)
      .attr('fill', (n) => taskFill(n.data))
      .attr('fill-opacity', 0.85)
      .attr('stroke', TASK_STROKE_DEFAULT)
      .attr('stroke-width', 1)
      .style('cursor', 'pointer')
      .on('mouseover', (event, n) => {
        const rect = svgEl.getBoundingClientRect()
        setHover({
          kind: 'task',
          node: n.data,
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        })
      })
      .on('mousemove', (event) => {
        const rect = svgEl.getBoundingClientRect()
        setHover((prev) =>
          prev && prev.kind === 'task'
            ? { ...prev, x: event.clientX - rect.left, y: event.clientY - rect.top }
            : prev
        )
      })
      .on('mouseout', () => setHover(null))

    // ----- Apply selection highlights ------------------------------------
    function applyHighlights(selectedEmp: string | null) {
      const isSelected = (n: SimNode): boolean => {
        if (!selectedEmp) return true
        if (n.kind === 'employee') {
          if (n.id === selectedEmp) return true
          // Also highlight connected employees
          return data.connections.some(
            (c) =>
              (c.source_employee_id === selectedEmp && c.target_employee_id === n.id) ||
              (c.target_employee_id === selectedEmp && c.source_employee_id === n.id)
          )
        }
        // Task node — highlight only if owned by selected employee
        return n.data.employee_id === selectedEmp
      }
      empGroup.style('opacity', (n) => (isSelected(n) ? 1 : 0.25))
      taskGroup.style('opacity', (n) => (isSelected(n) ? 1 : 0.2))
      linkSelection.style('opacity', (l) => {
        if (!selectedEmp) return 1
        const src = (l.source as SimNode).id
        const dst = (l.target as SimNode).id
        return src === selectedEmp || dst === selectedEmp ? 1 : 0.15
      })
      clusterPaths.style('opacity', (c) => {
        if (!selectedEmp) return 1
        return c.employee_ids.includes(selectedEmp) ? 1 : 0.25
      })
    }
    applyHighlights(selectedEmployeeId)

    // ----- Tick handler ------------------------------------------------
    function updatePositions() {
      empGroup.attr('transform', (n) => `translate(${n.x ?? 0}, ${n.y ?? 0})`)
      taskGroup.attr('cx', (n) => n.x ?? 0).attr('cy', (n) => n.y ?? 0)
      linkSelection
        .attr('x1', (l) => (l.source as SimNode).x ?? 0)
        .attr('y1', (l) => (l.source as SimNode).y ?? 0)
        .attr('x2', (l) => (l.target as SimNode).x ?? 0)
        .attr('y2', (l) => (l.target as SimNode).y ?? 0)

      // Cluster paths — convex hull around task nodes in the cluster,
      // padded out so they wrap around their nodes.
      clusterPaths.attr('d', (cluster) => {
        const pts: [number, number][] = []
        for (const tid of cluster.task_node_ids) {
          const n = nodeById.get(tid) as SimTaskNode | undefined
          if (n && n.x != null && n.y != null) {
            pts.push([n.x, n.y])
          }
        }
        // Also include the employees in the cluster for visual anchor.
        for (const eid of cluster.employee_ids) {
          const n = nodeById.get(eid) as SimEmployeeNode | undefined
          if (n && n.x != null && n.y != null) {
            pts.push([n.x, n.y])
          }
        }
        if (pts.length < 3) {
          // Render a soft circle around the centroid for 1-2 point hulls.
          if (pts.length === 0) return ''
          const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
          const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
          const r = 60
          return `M ${cx - r},${cy} A ${r},${r} 0 1,0 ${cx + r},${cy} A ${r},${r} 0 1,0 ${cx - r},${cy} Z`
        }
        const hull = d3.polygonHull(pts)
        if (!hull) return ''
        // Pad the hull outward by 24px so it wraps comfortably.
        const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
        const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length
        const padded = hull.map(([x, y]) => {
          const dx = x - cx
          const dy = y - cy
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const scale = 1 + 28 / dist
          return [cx + dx * scale, cy + dy * scale] as [number, number]
        })
        const line = d3.line<[number, number]>().curve(d3.curveCatmullRomClosed.alpha(0.8))
        return line(padded) || ''
      })
    }

    sim.on('tick', updatePositions)

    // Ambient drift: after initial settle, keep a slow alpha so nodes
    // shimmer slightly. Visually communicates "this is live".
    sim.on('end', () => {
      sim.alphaTarget(0.03).restart()
    })

    return () => {
      sim.stop()
    }
    // We deliberately omit hover/setHover/setSelectedEmployeeId/onClusterClick
    // from deps — D3 owns the DOM and we re-bind handlers via closures on
    // every data/width change. Including the callbacks would teardown and
    // rebuild the simulation on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width, height])

  // When the selected employee changes, re-apply highlights without
  // rebuilding the simulation. We do this by listening to changes and
  // running D3 selections against the existing DOM.
  useEffect(() => {
    if (!svgRef.current) return
    const svg = d3.select(svgRef.current)
    const empGroup = svg.selectAll<SVGGElement, SimEmployeeNode>('g.employee')
    const taskGroup = svg.selectAll<SVGCircleElement, SimTaskNode>('circle.task')
    const linkSelection = svg.selectAll<SVGLineElement, SimLink>('line.connection')
    const clusterPaths = svg.selectAll<SVGPathElement, WorkflowCluster>('path.cluster-region')

    const selectedEmp = selectedEmployeeId
    function isSelectedNode(n: SimNode): boolean {
      if (!selectedEmp) return true
      if (n.kind === 'employee') {
        if (n.id === selectedEmp) return true
        return data.connections.some(
          (c) =>
            (c.source_employee_id === selectedEmp && c.target_employee_id === n.id) ||
            (c.target_employee_id === selectedEmp && c.source_employee_id === n.id)
        )
      }
      return n.data.employee_id === selectedEmp
    }
    empGroup.style('opacity', (n) => (isSelectedNode(n) ? 1 : 0.25))
    taskGroup.style('opacity', (n) => (isSelectedNode(n) ? 1 : 0.2))
    linkSelection.style('opacity', (l) => {
      if (!selectedEmp) return 1
      const src = (l.source as SimNode).id
      const dst = (l.target as SimNode).id
      return src === selectedEmp || dst === selectedEmp ? 1 : 0.15
    })
    clusterPaths.style('opacity', (c) => {
      if (!selectedEmp) return 1
      return c.employee_ids.includes(selectedEmp) ? 1 : 0.25
    })
  }, [selectedEmployeeId, data])

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ height }}
      onClick={(e) => {
        // Click on empty SVG background clears selection.
        if (e.target === e.currentTarget || (e.target as Element).tagName === 'svg') {
          setSelectedEmployeeId(null)
        }
      }}
    >
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block' }}
      >
        {/* CSS-only pulse for the employee outer rings */}
        <style>{`
          g.employee circle.pulse {
            animation: gw-pulse 2.4s ease-in-out infinite;
            transform-origin: center;
            transform-box: fill-box;
          }
          @keyframes gw-pulse {
            0%, 100% { opacity: 0.15; transform: scale(1); }
            50%      { opacity: 0.3;  transform: scale(1.15); }
          }
        `}</style>
      </svg>
    </div>
  )
}

// ----- Tooltip -----------------------------------------------------------

function HoverTooltip({ hover }: { hover: NonNullable<HoverState> }) {
  // Position the tooltip with small offset, clamp inside the container.
  const style: React.CSSProperties = {
    position: 'absolute',
    left: Math.min(hover.x + 14, 9999),
    top: Math.max(hover.y + 14, 0),
    pointerEvents: 'none',
    zIndex: 30,
  }
  if (hover.kind === 'employee') {
    return (
      <div
        style={style}
        className="bg-gray-900/95 backdrop-blur border border-gray-700 rounded-lg px-3 py-2 text-xs text-white shadow-2xl max-w-xs"
      >
        <p className="font-semibold">{hover.node.name}</p>
        {hover.node.role && (
          <p className="text-gray-400 text-[10px] mt-0.5">{hover.node.role}</p>
        )}
        <p className="text-gray-300 mt-1.5">
          <span className="text-amber-300 font-medium">
            {hover.node.total_capture_count}
          </span>{' '}
          captures · {hover.node.automatable_capture_count} automatable
        </p>
        {hover.node.top_tasks.length > 0 && (
          <div className="mt-2 space-y-0.5">
            {hover.node.top_tasks.map((t, i) => (
              <p key={i} className="text-gray-300 text-[11px] truncate">
                · {t.task} ({t.count})
              </p>
            ))}
          </div>
        )}
      </div>
    )
  }
  if (hover.kind === 'task') {
    return (
      <div
        style={style}
        className="bg-gray-900/95 backdrop-blur border border-gray-700 rounded-lg px-3 py-2 text-xs text-white shadow-2xl max-w-xs"
      >
        <p className="font-medium leading-tight">{hover.node.label}</p>
        <p className="text-gray-400 text-[10px] mt-1">
          {hover.node.frequency} captures · {hover.node.category ?? 'uncategorized'}
        </p>
        <p
          className={`text-[10px] mt-0.5 ${
            hover.node.automation_potential === 'high'
              ? 'text-amber-300'
              : hover.node.automation_potential === 'medium'
              ? 'text-cyan-300'
              : 'text-gray-400'
          }`}
        >
          {hover.node.automation_potential} automation potential
        </p>
      </div>
    )
  }
  // cluster
  return (
    <div
      style={style}
      className="bg-gray-900/95 backdrop-blur border border-amber-700/40 rounded-lg px-3 py-2 text-xs text-white shadow-2xl max-w-sm"
    >
      <p className="font-semibold text-amber-300">{hover.cluster.label}</p>
      <p className="text-gray-300 mt-1 text-[11px] leading-relaxed">
        {hover.cluster.description}
      </p>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
        <span>
          {hover.cluster.employee_ids.length} people ·{' '}
          <span className="text-gray-200">
            {hover.cluster.weekly_minutes} min/wk
          </span>
        </span>
        <span className="text-amber-300 font-medium">
          {fmtMoney(hover.cluster.annual_savings)}/yr
        </span>
      </div>
      <p className="text-[10px] text-gray-500 mt-1">
        Click for full detail
      </p>
    </div>
  )
}

// ----- Empty state ------------------------------------------------------

function EmptyState({ height }: { height: number }) {
  return (
    <div
      className="w-full flex items-center justify-center"
      style={{ height }}
    >
      <div className="text-center max-w-md px-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 mb-4">
          <Sparkles className="w-6 h-6 text-indigo-300" />
        </div>
        <h3 className="text-base font-semibold text-white">
          Your team's workflow map is loading data
        </h3>
        <p className="text-sm text-gray-400 mt-2 leading-relaxed">
          This map shows every employee, the tasks they spend the most
          time on, and the automation opportunities where their work
          overlaps. It populates once the agents have been running for
          a few days — give it 24-72 hours.
        </p>
      </div>
    </div>
  )
}

// ----- Collapsed bar ----------------------------------------------------

function CollapsedBar({
  data,
  onExpand,
}: {
  data: WorkflowIntelligencePayload | null
  onExpand: () => void
}) {
  const summary = data
    ? data.clusters.length > 0
      ? `${data.clusters.length} automation cluster${
          data.clusters.length === 1 ? '' : 's'
        } detected · ${fmtMoney(data.total_annual_savings)}/yr combined opportunity`
      : 'No automation clusters detected yet'
    : 'Workflow intelligence loading...'
  return (
    <button
      type="button"
      onClick={onExpand}
      className="w-full flex items-center justify-between gap-3 px-5 py-3 rounded-2xl border border-gray-800/50 transition-colors hover:border-indigo-500/40"
      style={{ background: BG_COLOR }}
    >
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
          <Sparkles className="w-3.5 h-3.5 text-indigo-300" />
        </div>
        <div className="text-left">
          <p className="text-[10px] uppercase tracking-wider text-indigo-300/70 font-semibold">
            Workflow Intelligence
          </p>
          <p className="text-sm text-white font-medium">{summary}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 text-xs text-gray-400">
        Expand
        <ChevronDown className="w-3 h-3" />
      </div>
    </button>
  )
}

// ----- Tiny styled select ----------------------------------------------

function DarkSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-xs px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-200 focus:outline-none focus:border-indigo-400/60"
      style={{ colorScheme: 'dark' }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-gray-900 text-white">
          {o.label}
        </option>
      ))}
    </select>
  )
}
