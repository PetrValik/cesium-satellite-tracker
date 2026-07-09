export const meta = {
  name: 'parallel-features',
  description: 'Implement a batch of disjoint feature specs in parallel, each gated by a reviewer and one fix round',
  whenToUse: 'When several features with non-overlapping file ownership are specced and ready to build.',
  phases: [
    { title: 'Implement', detail: 'one specialist agent per feature' },
    { title: 'Gate', detail: 'reviewer per feature, fix round if needed' },
  ],
}

// args: { context: string, features: [{ name, spec, agentType?, files: string[] }] }
if (!args || !Array.isArray(args.features) || args.features.length === 0) {
  throw new Error('parallel-features requires args.features: [{name, spec, agentType?, files}]')
}
const context = args.context || ''

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['pass', 'needs-fixes'] },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'issues'],
}

const results = await pipeline(
  args.features,
  (f) =>
    agent(
      `${context}\n\nImplement this feature COMPLETELY in the current repo.\n\nFEATURE: ${f.name}\n\nSPEC:\n${f.spec}\n\nFILE OWNERSHIP: you may create/edit ONLY these paths (plus their test files): ${f.files.join(', ')}. Do NOT touch any other file — shared files are integrated by the orchestrator later. If the spec requires a change elsewhere, note it in your final summary instead of making it.\n\nWhen done, run the repo's typecheck/build for your workspace if available and fix what you broke. Return: files created/changed, notes for the integrator, any deviations from spec.`,
      { label: `impl:${f.name}`, phase: 'Implement', agentType: f.agentType }
    ),
  (implSummary, f) =>
    agent(
      `You are reviewing the just-implemented feature "${f.name}" in this repo. Implementer summary:\n${implSummary}\n\nSPEC:\n${f.spec}\n\nRead the actual files (${f.files.join(', ')}) and judge: does the implementation match the spec, is it correct (frames/units/lifecycle/state), is it complete (no stubs/TODOs)? List concrete issues with file:line. Verdict "needs-fixes" only for real defects, not taste.`,
      { label: `review:${f.name}`, phase: 'Gate', schema: REVIEW_SCHEMA }
    ).then(async (review) => {
      if (review.verdict === 'pass') return { feature: f.name, status: 'pass', impl: implSummary }
      const fix = await agent(
        `Fix these confirmed review issues for feature "${f.name}" in the current repo. Same file ownership: ${f.files.join(', ')}.\n\nISSUES:\n- ${review.issues.join('\n- ')}\n\nSPEC (for reference):\n${f.spec}\n\nReturn: what you fixed.`,
        { label: `fix:${f.name}`, phase: 'Gate', agentType: f.agentType }
      )
      return { feature: f.name, status: 'fixed', impl: implSummary, issues: review.issues, fix }
    })
)

return results.filter(Boolean)
