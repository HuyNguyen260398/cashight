#!/usr/bin/env bash
# Applies v2 minimal (terraform/v2-minimal) from the workstation, end to end:
#   1. refuse while the full v2 cluster (cashight-v2) exists: both point
#      api.cashight-v2.nghuy.link at their own ALB and consume the same queues;
#   2. create the cluster (targeted apply), then apply everything else (the
#      in-cluster bootstrap, roles, Lambdas and, once the ALB exists, DNS);
#   3. check the committed overlay against the Terraform outputs;
#   4. hand releases to .github/workflows/v2-minimal-release.yaml
#      (repository variable V2_TARGET=minimal).
# Idempotent: re-run it after the first deploy so the DNS record appears.
# docs/v2-minimal.md, "Apply".
#
# Test seams (scripts/__tests__/v2-minimal-scripts.test.ts): CHECK_OVERLAY.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

export AWS_REGION=${AWS_REGION:-ap-southeast-1}
CHECK_OVERLAY=${CHECK_OVERLAY:-scripts/v2-minimal/check-overlay.sh}
ROOT=terraform/v2-minimal

log() { echo "==> $*"; }
die() {
  echo "apply: $*" >&2
  exit 1
}

# cluster_exists <name>: 0 if it exists, 1 if EKS says it does not; dies on
# any other error rather than guessing.
cluster_exists() {
  local out
  if out=$(aws eks describe-cluster --name "$1" --region "$AWS_REGION" 2>&1); then
    return 0
  fi
  grep -q ResourceNotFoundException <<<"$out" || die "could not check whether $1 exists: $out"
  return 1
}

plan_dir=$(mktemp -d)
trap 'rm -rf "$plan_dir"' EXIT

# apply_root <root> <plan args...>: plan to a file, then apply exactly that plan.
apply_root() {
  local dir=$1 plan
  shift
  plan="$plan_dir/$(basename "$dir")-$RANDOM.tfplan"
  terraform -chdir="$dir" plan -input=false "$@" -out="$plan"
  terraform -chdir="$dir" apply -input=false "$plan"
}

if cluster_exists cashight-v2; then
  die "the full v2 cluster cashight-v2 exists; tear it down first: bash scripts/platform/teardown.sh \"destroy cashight-v2\""
fi

# check-overlay.sh reads terraform/v2's outputs too.
terraform -chdir=terraform/v2 init -input=false >/dev/null

log "Creating the cluster (targeted apply; 15-20 minutes)"
terraform -chdir="$ROOT" init -input=false
apply_root "$ROOT" -target=module.cluster

log "Applying the in-cluster bootstrap, roles, Lambdas and DNS"
apply_root "$ROOT"

log "Checking the overlay against Terraform"
"$CHECK_OVERLAY" || die "the committed overlay differs from Terraform; fix it and push before deploying"

log "Handing releases to v2-minimal-release.yaml (V2_TARGET=minimal)"
gh variable set V2_TARGET --body minimal

cat <<'NEXT'
==> v2 minimal is applied. Next:
  1. gh workflow run v2-minimal-release.yaml --ref cashight-v2   (first deploy; watch it go green)
  2. bash scripts/v2-minimal/apply.sh                            (again: creates the api.cashight-v2.nghuy.link record)
  3. terraform -chdir=terraform/grafana apply -var api_live=true -var collector_live=false
Tear down with: bash scripts/v2-minimal/teardown.sh "destroy cashight-v2-min"
NEXT
