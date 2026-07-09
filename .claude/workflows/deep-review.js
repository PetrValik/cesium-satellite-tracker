export const meta = {
  name: 'deep-review',
  description: 'Multi-dimension adversarial review of the current branch diff; returns only findings that survive refutation',
  whenToUse: 'Before merging substantive work: fan out dimension reviewers over the diff, then adversarially verify each finding.',
  phases: [
    { title: 'Review', detail: 'one reviewer per dimension' },
    { title: 'Verify', detail: 'two skeptics per finding, majority refutes' },
  ],
}

// args: { base?: string, dimensions?: [{key, prompt}] }
const base = (args && args.base) || 'main'

const DIMENSIONS = (args && args.dimensions) || [
  { key: 'correctness', prompt: 'logic bugs, wrong conditionals, off-by-one, broken control flow, unhandled promise rejections, race conditions' },
  { key: 'orbital-math', prompt: 'coordinate-frame mistakes (ECI vs ECEF vs geodetic), km-vs-meters unit errors, radians-vs-degrees, GMST reuse across different timestamps, wrong period/classification math' },
  { key: 'cesium-lifecycle', prompt: 'Cesium resource leaks (primitives/entities/listeners not removed), per-frame allocations in hot loops, viewer destroyed-then-used, React StrictMode double-init issues' },
  { key: 'react-state', prompt: 'stale closures over store state, effects with wrong deps, setState during render, subscription leaks, worker message handlers left attached' },
  { key: 'api-robustness', prompt: 'API server: SQL injection or bad binding, missing error handling on upstream fetch, cache-staleness logic bugs, blocking the event loop, unvalidated input' },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          failure: { type: 'string' },
        },
        required: ['file', 'summary', 'failure'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

const results = await pipeline(
  DIMENSIONS,
  (d) =>
    agent(
      `Review the diff of the current branch against "${base}" (run: git diff ${base}...HEAD) in this repo, looking ONLY for: ${d.prompt}.\n\nRead the full files around changed hunks — the diff alone lies about context. Report only defects a user could hit, with a concrete failure scenario. No style nits.`,
      { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS_SCHEMA }
    ),
  (review, d) =>
    parallel(
      (review.findings || []).slice(0, 12).map((f) => () =>
        parallel([
          () => agent(
            `Adversarially REFUTE this code-review finding in the current repo. Read the actual code. Finding: ${f.summary} at ${f.file}${f.line ? ':' + f.line : ''}. Claimed failure: ${f.failure}. If the code actually handles it, or the scenario is impossible, refuted=true. Default to refuted=true when uncertain.`,
            { label: `skeptic1:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
          ),
          () => agent(
            `Independently verify whether this finding reproduces, by reading the code and tracing the exact inputs: ${f.summary} at ${f.file}${f.line ? ':' + f.line : ''}. Failure claim: ${f.failure}. refuted=true unless you can trace a concrete path to the failure.`,
            { label: `skeptic2:${d.key}`, phase: 'Verify', schema: VERDICT_SCHEMA }
          ),
        ]).then((votes) => {
          const alive = votes.filter(Boolean)
          const confirmed = alive.length > 0 && alive.every((v) => !v.refuted)
          return confirmed ? { ...f, dimension: d.key } : null
        })
      )
    )
)

const confirmed = results.filter(Boolean).flat().filter(Boolean)
log(`${confirmed.length} findings survived adversarial verification`)
return { confirmed }
