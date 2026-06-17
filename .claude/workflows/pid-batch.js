export const meta = {
  name: 'pid-batch',
  description: 'Execute one batch of the Extraction P&ID task graph: fan out implement→verify per task, stop at 🔴 human gates',
  whenToUse: 'Run one batch at a time, e.g. Workflow({scriptPath, args:{batch:1}}). Advance batches between invocations to honor join barriers and review gates.',
  phases: [
    { title: 'Implement' },
    { title: 'Verify' },
    { title: 'Human gate' },
  ],
}

// Static batch map — mirrors docs/TASK_GRAPH_v0.2.0.md and the live Linear board.
// loop: 'auto' 🟢 | 'snapshot' 🟡 | 'human' 🔴.  gate: 'review' | 'phase-exit' | null.
const BATCHES = {
  1:  [{ id: 'DEV-1129', t: 'Repo scaffold + tooling', loop: 'auto', gate: null, first: true },
       { id: 'DEV-1130', t: 'Domain types + Zod schemas', loop: 'auto', gate: null },
       { id: 'DEV-1131', t: 'Symbol library + required attrs', loop: 'snapshot', gate: null }],
  2:  [{ id: 'DEV-1132', t: 'Postgres schema + migrations', loop: 'auto', gate: null },
       { id: 'DEV-1133', t: 'Validator — connectivity rules', loop: 'auto', gate: 'review' },
       { id: 'DEV-1134', t: 'Account auth (web login)', loop: 'auto', gate: null }],
  3:  [{ id: 'DEV-1135', t: 'Diagram persistence + versioning', loop: 'auto', gate: null },
       { id: 'DEV-1136', t: 'Metadata store (element-id-keyed)', loop: 'auto', gate: null },
       { id: 'DEV-1137', t: 'Excalidraw canvas mount + palette', loop: 'snapshot', gate: null }],
  4:  [{ id: 'DEV-1138', t: 'Manual connect — bind on create', loop: 'snapshot', gate: null },
       { id: 'DEV-1139', t: 'Connect — rebind on move/delete', loop: 'snapshot', gate: null },
       { id: 'DEV-1140', t: 'Commit pipeline', loop: 'auto', gate: null }],
  5:  [{ id: 'DEV-1141', t: 'E2E manual workflow', loop: 'snapshot', gate: 'phase-exit' }],
  6:  [{ id: 'DEV-1142', t: 'Server-side SVG render', loop: 'snapshot', gate: null },
       { id: 'DEV-1143', t: 'Transport-fallback seam', loop: 'auto', gate: null },
       { id: 'DEV-1144', t: 'Proposal model + lifecycle', loop: 'auto', gate: 'review' }],
  7:  [{ id: 'DEV-1145', t: 'MCP server skeleton (Streamable HTTP)', loop: 'human', gate: 'review' },
       { id: 'DEV-1146', t: 'MCP read tools', loop: 'auto', gate: null }],
  8:  [{ id: 'DEV-1147', t: 'MCP OAuth provider + token issuance', loop: 'human', gate: null },
       { id: 'DEV-1148', t: 'DCR + 401 re-registration', loop: 'human', gate: null },
       { id: 'DEV-1149', t: 'Account → active-diagram scoping', loop: 'auto', gate: null },
       { id: 'DEV-1150', t: 'MCP propose tools', loop: 'auto', gate: null }],
  9:  [{ id: 'DEV-1151', t: 'WebSocket sync — broadcast + apply', loop: 'snapshot', gate: null },
       { id: 'DEV-1152', t: 'Sync — in-progress-edit guard', loop: 'snapshot', gate: 'review' },
       { id: 'DEV-1153', t: 'Pending-proposal canvas UI', loop: 'snapshot', gate: null }],
  10: [{ id: 'DEV-1154', t: 'In-app connector onboarding', loop: 'human', gate: null },
       { id: 'DEV-1155', t: 'E2E Claude loop', loop: 'human', gate: 'phase-exit' }],
  11: [{ id: 'DEV-1156', t: 'Line-list export (CSV + JSON)', loop: 'auto', gate: null },
       { id: 'DEV-1157', t: 'Diagram export (.excalidraw + SVG)', loop: 'auto', gate: null },
       { id: 'DEV-1158', t: 'Multi-tenant isolation review + tests', loop: 'auto', gate: null }],
  12: [{ id: 'DEV-1159', t: 'Full canonical workflow', loop: 'human', gate: 'phase-exit' }],
}

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'status', 'summary'],
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['green', 'failed', 'human-gate'] },
    summary: { type: 'string', description: 'what was built + verification outcome' },
    branch: { type: 'string' },
    humanVerifyPath: { type: 'string', description: 'path to HUMAN-VERIFY-<id>.md if human-gated' },
  },
}

const CONTEXT = `Read CLAUDE.md (repo root), docs/EXECUTION.md, docs/PRD_extraction-pid-coeditor_v0.1.0.md, and docs/TASK_GRAPH_v0.2.0.md first. ` +
  `Fetch the Linear issue via the linear-staqs MCP tools (ToolSearch for mcp__linear-staqs__get_issue) to get the full acceptance criteria. ` +
  `Uphold every architecture invariant in CLAUDE.md. Touch ONLY the files this task owns — if you find yourself editing another task's file, stop, the boundary is wrong. ` +
  `Tests-first for validator, arrow-binding, proposal lifecycle, and sync-guard tasks. Work on branch dustin/<lowercased-id> and commit atomically.`

let parsedArgs = args
if (typeof parsedArgs === 'string') {
  try { parsedArgs = JSON.parse(parsedArgs) } catch { parsedArgs = { batch: Number(parsedArgs) } }
}
const batchNum = Number(parsedArgs && typeof parsedArgs === 'object' ? parsedArgs.batch : parsedArgs)
if (!batchNum || !BATCHES[batchNum]) {
  throw new Error(`Pass args.batch as one of: ${Object.keys(BATCHES).join(', ')}`)
}
const skip = (parsedArgs && parsedArgs.skip) || []
const only = (parsedArgs && parsedArgs.only) || null
let tasks = BATCHES[batchNum]
if (only) tasks = tasks.filter(t => only.includes(t.id))
if (skip.length) tasks = tasks.filter(t => !skip.includes(t.id))
if (!tasks.length) throw new Error(`No tasks left in batch ${batchNum} after only/skip filter`)
log(`Batch ${batchNum}: ${tasks.map(t => t.id).join(', ')}${skip.length ? ` (skipping ${skip.join(', ')})` : ''}`)

// Scaffold (batch 1) must land before its siblings can typecheck.
const first = tasks.find(t => t.first)
if (first) {
  phase('Implement')
  log(`Landing ${first.id} (${first.t}) before fan-out — siblings need the toolchain.`)
  await agent(
    `${CONTEXT}\n\nImplement ${first.id} — ${first.t}. Loop until \`pnpm test && pnpm lint && pnpm typecheck\` are all green.`,
    { label: first.id, phase: 'Implement', agentType: 'compliant-implementer', isolation: 'worktree', schema: RESULT_SCHEMA },
  )
}
const rest = tasks.filter(t => !t.first)

const results = await pipeline(
  rest,
  // Stage 1 — implement (🔴 build-to-scaffold; others loop to green)
  (task) => {
    if (task.loop === 'human') {
      return agent(
        `${CONTEXT}\n\nImplement ${task.id} — ${task.t}. This is a 🔴 HUMAN-gated task: build everything an agent can, ` +
        `then WRITE docs/HUMAN-VERIFY-${task.id}.md with the exact manual steps a human must perform in Claude Desktop ` +
        `(connector add / OAuth / live accept). Do NOT self-certify done. Return status "human-gate" with humanVerifyPath set.`,
        { label: task.id, phase: 'Human gate', agentType: 'compliant-implementer', schema: RESULT_SCHEMA },
      )
    }
    const snap = task.loop === 'snapshot'
      ? ` This is 🟡: also produce/refresh the golden SVG/screenshot under test/golden and assert the render matches within tolerance.`
      : ''
    return agent(
      `${CONTEXT}\n\nImplement ${task.id} — ${task.t}. Loop until \`pnpm test && pnpm lint && pnpm typecheck\` are all green.${snap}`,
      { label: task.id, phase: 'Implement', agentType: 'compliant-implementer', isolation: 'worktree', schema: RESULT_SCHEMA },
    )
  },
  // Stage 2 — independent verification (skip for human-gated)
  (res, task) => {
    if (!res || res.status === 'human-gate') return res
    return agent(
      `${CONTEXT}\n\nIndependently VERIFY ${task.id} — ${task.t}. Check out branch dustin/${task.id.toLowerCase()}, ` +
      `run \`pnpm test && pnpm lint && pnpm typecheck\`, confirm the Linear acceptance criteria are actually met ` +
      `(not just that tasks were edited), and for 🟡 confirm the golden compare passes. Return status "green" only if it truly passes, else "failed" with what's wrong.`,
      { label: `verify:${task.id}`, phase: 'Verify', agentType: 'test-engineer', schema: RESULT_SCHEMA },
    )
  },
)

const all = [first ? { id: first.id, status: 'green', summary: 'scaffold landed' } : null, ...results].filter(Boolean)
const humanGates = all.filter(r => r.status === 'human-gate')
const failed = all.filter(r => r.status === 'failed')
const reviewGate = tasks.filter(t => t.gate === 'review').map(t => t.id)
const phaseGate = tasks.filter(t => t.gate === 'phase-exit').map(t => t.id)

if (humanGates.length) {
  phase('Human gate')
  log(`🔴 STOP — human action required for: ${humanGates.map(r => `${r.id} (${r.humanVerifyPath || 'HUMAN-VERIFY pending'})`).join(', ')}`)
}
if (reviewGate.length) log(`⚠️ REVIEW GATE after: ${reviewGate.join(', ')} — get sign-off before dependent batches.`)
if (phaseGate.length) log(`⛔ PHASE-EXIT GATE: ${phaseGate.join(', ')} — all exit criteria must be green before crossing.`)
if (failed.length) log(`❌ Failed verification: ${failed.map(r => r.id).join(', ')} — re-run before advancing.`)

return {
  batch: batchNum,
  results: all,
  humanGates: humanGates.map(r => r.id),
  failed: failed.map(r => r.id),
  reviewGate,
  phaseGate,
  advanceOk: failed.length === 0 && humanGates.length === 0 && reviewGate.length === 0 && phaseGate.length === 0,
}
