# Cashight v2 minimal — progress (paused 2026-11-10)

Plan: [`2026-11-09-cashight-v2-minimal.md`](2026-11-09-cashight-v2-minimal.md) · Spec: [`../specs/2026-11-08-cashight-v2-minimal-design.md`](../specs/2026-11-08-cashight-v2-minimal-design.md)
Branch: `cashight-v2-minimal` (from `cashight-v2` at `82ffe2a`), **not pushed**, no PR yet. Head: `622027f`.
Execution ledger (gitignored, local only): `.superpowers/sdd/2026-11-09-cashight-v2-minimal/progress.md`.

## Status

| Task | State | Commit(s) |
|---|---|---|
| 1. Merged API entrypoint + `AI_SUMMARY_ENABLED` | done | `80d01a1` |
| 2. SPA flag `NEXT_PUBLIC_ENABLE_AI_SUMMARY` | done | `b645744` |
| 3. Smoke check: summary routes 404 | done | `e08b8ec` |
| 4. Module `platform_cluster_fargate` | done | `b955102` |
| 5. Root `terraform/v2-minimal` | done | `797a602` |
| 6. Worker Lambdas | done | `aae1efe` |
| 7. CI-role grants (`terraform/v2`), tag budget (`platform-base`) | done | `342a39e` |
| 8. Overlay `deploy/cashight/overlays/v2-minimal` | done | `ef25594` |
| 9. Release workflow, deploy/rollback scripts | done | `d7889c1` |
| 10. Operator scripts, bring-up guard, docs | done | `f974042` |
| Final review (separate reviewer) + fix pass | done | `4a6f826`, `c32d7a8`, `622027f` |
| **11. Go-live and acceptance (live)** | **not started; needs approval** | — |

Last full verification (2026-11-10), all green:
- `pnpm test`: 1264 passed, 1 skipped.
- `tsc`, lint: no errors (9 pre-existing warnings).
- `terraform test`: v2 11/11, v2-minimal 11/11, platform 8/8, platform-base 5/5.
- fmt, TFLint, Checkov, shellcheck, actionlint and the manifest checks pass.
- `check-collector.sh` not run to completion locally: it needs Docker, which wasn't running; the collector is untouched.

## Next steps

1. **Before go-live:**
   - `terraform -chdir=terraform/v2 apply`: adds the CI-role grants `EksDescribeMinimal` and `DeployMinimalWorkers`.
   - Create `terraform/v2-minimal/terraform.tfvars` (gitignored) with `admin_principal_arns = ["arn:aws:iam::<account>:role/<admin-role>"]`.
   - Make sure the full cluster `cashight-v2` is down.
2. **Task 11** (plan §Task 11; runbook in `docs/v2-minimal.md`):
   1. Price check (Price List API). Stop if the total is over $185/month.
   2. `bash scripts/v2-minimal/apply.sh`, then verify pods, DNS and standard support.
   3. `gh workflow run v2-minimal-release.yaml --ref cashight-v2`. It should go green: before the DNS record exists, it checks through the ALB.
   4. Re-run `apply.sh` to create the DNS record, then apply Grafana with `api_live=true collector_live=false`.
   5. Broken-build rollback test.
   6. Upload the TPBank and VIB sample PDFs.
   7. Mutual-exclusion check.
   8. Logs.
   9. Seven days later: Cost Explorer, then `enable_v2_minimal_budget = true`.
   10. Record the results in `docs/v2-minimal.md` ("Acceptance record").
3. Push the branch and open a PR into `cashight-v2` (before or after go-live — undecided).
4. Optionally address the deferred minors below.

## Rulings made during execution (deviations from the plan)

**Task 3**
- Smoke tests run the real script against a local stub HTTP server; the plan's "fetch-stub pattern" doesn't exist in that file.

**Task 4**
- Fargate profiles are created through the EKS module's `fargate_profiles` with a shared role, so CoreDNS is created after the profiles.
- Extra module outputs (`nat_gateway_ids`, `gateway_endpoint_types`, `managed_node_group_count`, `upgrade_support_type`) exist for the tests.
- `create_node_security_group = false`.

**Task 5**
- The mutual-exclusion guard feeds the cluster name through `terraform_data.output` instead of using a module `depends_on`. `depends_on` defers EKS-module data sources and breaks the plan; the guard still runs in `-target=module.cluster`.
- `data.aws_lbs` has no `depends_on`, for the same reason.
- The LBC chart is pinned to 1.14.0, the full platform's version, which shares the IAM policy. 3.6.x exists.
- No Checkov skips were needed for `CKV_AWS_39`/`CKV_AWS_37`.

**Task 6**
- The workers test overrides the alias ARNs at plan.

**Task 8**
- The manifest check carries a few extra guards: namespace, `APP_VERSION`, ServiceAccount.

**Task 9**
- Rollback undoes to the revision recorded before the release (`record-revision.sh`, `--to-revision`), not "undo when history > 1".
- The deploy job installs `kubectl` and `yq` itself.
- The manifest check stays in the PR gate only.

**Task 10**
- The existence checks die on any `describe-cluster` error other than `ResourceNotFoundException`.
- Teardown polls for ALBs by the `k8s-cashight-` name prefix.

**Final review fixes**
- The ALB readiness gate label is set on the `cashight` namespace.
- The LBC uses `defaultTags`.
- The ConfigMap is renamed per release (`version-release.sh`); unused ones are pruned after a successful release (`prune-config.sh`).
- The first deploy checks through the ALB (`api-endpoint.sh`, `CONNECT_TO`, `SMOKE_API_CONNECT_TO`).
- Rollback still doesn't revert Service, Ingress or ServiceAccount changes (documented).

## Deferred minor findings

- With AI summaries off, the dashboard KPI panel stays `xl:col-span-7`, leaving an empty area.
- `deploy-workers.sh` waits on `$LATEST`, not `wait published-version-active` for the published version.
- Lambda versions are never pruned.
- `record-revision.sh` treats any `kubectl` error as "first deploy".
- Rollback runs on `failure()` only, not on `cancelled()`.
- The `yq` download in the release workflow isn't checksum-verified.
- A Terraform-only Lambda env change publishes a version `live` doesn't point to until the next CI deploy (undocumented).
- `terraform/modules/platform_cluster_fargate/.terraform.lock.hcl` is still untracked; delete or ignore it.
- `mint-smoke-token.sh` passes the client secret on curl's command line (`-u`), as before.
