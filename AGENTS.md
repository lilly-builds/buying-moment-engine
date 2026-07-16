<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Engineering workflow

Follow **SCOPE → BUILD → VERIFY → REVIEW → SHIP** for material changes.

## Worktree isolation

- Never edit this repository directly on `main`.
- Start from the latest `origin/main` in a new dedicated worktree and branch.
- Inspect existing worktrees first. Never use or modify another agent's worktree.
- Preserve all pre-existing uncommitted work. Never clean, reset, restore, stash, or overwrite it.

## Product verification

Use [the verification policy](docs/engineering/verification-policy.md) for critical workflows, external providers, cron jobs, migrations, multi-stage pipelines, production fixes, and cross-layer features.

- Define the product promise, verification tier, real entry path, required subsystems, and evidence before implementation.
- Treat every enabled signal, provider, stage, persistence write, and user-facing surface as required unless the task explicitly excludes it.
- Add unit and integration tests with each behavior change.
- Reproduce the original failure and test positive, negative, recovery, and regression paths.
- For batching, fan-out, queueing, timeout, fairness, or coverage work, test a realistic set rather than one ideal record.
- Exercise the real route, cron endpoint, job, or user path. Helper-only tests do not prove the product works.
- Do not call reduced capacity, disabled coverage, weaker checks, or skipped providers a fix. Label temporary containment as degraded behavior.

## Review and release

- Run `pnpm typecheck`, `pnpm lint`, `pnpm test:coverage`, and `pnpm build` before declaring a material change locally verified.
- Use the repository's compound-engineering planning, worktree, testing, and code-review workflows when available.
- Material changes require a fresh-context review before merge.
- Production-dependent work is not production verified until the live path and persisted result are observed.
- Public pull requests must use sanitized evidence. Never include customer identities, credentials, private production rows, or secret values.

## Completion language

Use one exact status:

- Implemented, not fully tested
- Locally verified
- Production verified
- Partially working
- Blocked
- Failed verification

Report failed, skipped, degraded, mocked, and untested areas before successes. Never say “done,” “fixed,” or “ship-ready” when required proof is missing.
