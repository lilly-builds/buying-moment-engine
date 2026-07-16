# Product verification policy

This policy prevents a narrow implementation or isolated test from being mistaken for a working product.

## Verification tiers

| Tier | Use for | Required proof |
|---|---|---|
| 1 | Copy, styling, isolated low-risk mechanics | Relevant checks and a smoke test |
| 2 | Normal application behavior | Unit tests, integration tests, and the real entry path |
| 3 | Cron jobs, external providers, migrations, critical workflows, agent behavior, and multi-stage pipelines | Tier 2 plus failure recovery, realistic scale, fresh review, and live proof for production claims |
| 4 | Security, billing, irreversible writes, regulated data, or high-blast-radius releases | Tier 3 plus adversarial checks, rollback proof, and human approval for live actions |

Default upward when uncertain. Lower the tier only when the product promise is explicitly narrowed.

## Verification contract

Define this before implementation:

1. **Product promise:** the user-visible or operational result.
2. **Status target:** the strongest honest outcome for the task.
3. **Tier:** the selected tier and risk reasons.
4. **Real path:** trigger → authorization and tenant → orchestration → sources and providers → persistence → queries → visible result → monitoring.
5. **Required subsystems:** every enabled source, provider, stage, data write, and surface.
6. **Controls:** positive, negative, recovery, regression, and realistic scale.
7. **Production proof:** the exact live observation needed.
8. **Approved exclusions:** only scope removed explicitly by the task owner.

## Required subsystem matrix

Track every core part separately:

| Subsystem | Why it is required | Evidence | Result |
|---|---|---|---|
| Name each enabled part | Connection to the product promise | Test, query, log, or live observation | Pending, passed, failed, skipped, degraded, or mocked |

A successful output from one branch does not compensate for another required branch failing. These are AND gates.

## Minimum controls

- **Positive control:** proves the intended result is produced.
- **Negative control:** proves invalid or irrelevant input is rejected.
- **Recovery control:** proves timeout, retry, partial provider failure, or resume behavior.
- **Regression control:** reproduces the original defect and proves it no longer occurs.
- **Scale control:** exercises realistic batching, fan-out, queueing, fairness, timing, or coverage.

## Root-cause rule

The following are not root-cause fixes unless the task owner explicitly accepts the tradeoff:

- processing fewer records;
- disabling a source or stage;
- lowering quality thresholds;
- removing retries or validation;
- replacing a real integration with a mock;
- hiding failures as skips;
- reporting successes while omitting failed branches.

If temporary containment is necessary, label it **degraded mitigation**, preserve the original requirement, and record the blocking follow-up.

## Evidence standards

Acceptable evidence comes from:

- tests that were actually run;
- the real route, endpoint, job, command, or user flow;
- deliberate database or provider observations;
- production behavior when production is part of the claim;
- a fresh-context review of the final diff.

Code inspection and inference are useful for diagnosis but are not proof that the system ran successfully.

## Final status

Choose exactly one:

- **Implemented, not fully tested**
- **Locally verified**
- **Production verified**
- **Partially working**
- **Blocked**
- **Failed verification**

The final report must list, in order:

1. status;
2. product promise tested;
3. passed evidence;
4. failures, skips, degradation, and mocks;
5. production evidence;
6. residual risks;
7. exact next action.
