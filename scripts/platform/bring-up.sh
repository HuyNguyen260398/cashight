#!/usr/bin/env bash
# Brings the v2 test environment up from nothing, end to end:
#   1. refuse an overlay whose image was never built (all-zero digest);
#   2. copy the AUTHZ records into the v2 table (dry run first);
#   3. create the cluster (targeted apply), wait for the Argo CD capability;
#   4. apply the bootstrap, wait for the cashight Application to be Healthy;
#   5. point api.cashight-v2.nghuy.link at the ALB (api_alb_ready=true);
#   6. check the overlay against Terraform, wait for DNS and /health, smoke;
#   7. only then switch the Grafana uptime and telemetry alerts on.
# Exit 0 only when smoke passed. Re-running continues from wherever it stopped:
# every step is idempotent. docs/platform.md, "Test day: bring-up".
#
# Test seams (scripts/__tests__/platform-scripts.test.ts): OVERLAY,
# CHECK_OVERLAY, POLL_SECONDS. Cognito values default to the repository
# variables (gh variable get) unless set in the environment.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

export AWS_REGION=${AWS_REGION:-ap-southeast-1}
OVERLAY=${OVERLAY:-deploy/cashight/overlays/v2}
CHECK_OVERLAY=${CHECK_OVERLAY:-scripts/platform/check-overlay.sh}
POLL_SECONDS=${POLL_SECONDS:-15}
APP_URL=https://cashight-v2.nghuy.link
API_HOST=api.cashight-v2.nghuy.link
PLATFORM=terraform/platform
GRAFANA=terraform/grafana

log() { echo "==> $*"; }
die() {
  echo "bring-up: $*" >&2
  exit 1
}

# wait_for <timeout-seconds> <description> <command...>: polls until the
# command succeeds; dies naming the description on timeout.
wait_for() {
  local timeout=$1 what=$2 waited=0
  shift 2
  until "$@"; do
    [ "$waited" -lt "$timeout" ] || die "timed out after ${timeout}s waiting for $what"
    sleep "$POLL_SECONDS"
    waited=$((waited + (POLL_SECONDS > 0 ? POLL_SECONDS : 1)))
  done
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

digest=$(yq -r '.images[] | select(.name == "cashight-backend") | .digest' "$OVERLAY/kustomization.yaml")
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || die "overlay image digest '$digest' is not a digest"
[ "$digest" != "sha256:$(printf '0%.0s' {1..64})" ] ||
  die "the cashight-backend image is not built yet (all-zero digest in $OVERLAY). Push to cashight-v2 and let the v2 Release workflow pin it."

aws sts get-caller-identity >/dev/null || die "no AWS credentials (eval \"\$(aws configure export-credentials --format env)\")"

# check-overlay.sh reads terraform/v2's outputs at step 5; initialise it now so
# a fresh checkout fails here, not after the cluster has been created.
terraform -chdir=terraform/v2 init -input=false >/dev/null

log "Copying AUTHZ records into the v2 table"
pnpm tsx scripts/v2/seed-authz.ts --source cashight --target cashight-v2 --dry-run
pnpm tsx scripts/v2/seed-authz.ts --source cashight --target cashight-v2

log "Creating the cluster (targeted apply; 15-20 minutes)"
terraform -chdir="$PLATFORM" init -input=false
apply_root "$PLATFORM" -target=module.platform_cluster
cluster=$(terraform -chdir="$PLATFORM" output -raw cluster_name)

capability_active() {
  local status
  status=$(aws eks describe-capability --cluster-name "$cluster" --capability-name "${cluster}-argocd" \
    --query 'capability.status' --output text 2>/dev/null || true)
  case "$status" in
    ACTIVE) return 0 ;;
    DEGRADED | DELETING | CREATE_FAILED | UPDATE_FAILED) die "${cluster}-argocd is $status" ;;
    *) return 1 ;;
  esac
}
log "Waiting for the Argo CD capability"
wait_for 1200 "the ${cluster}-argocd capability" capability_active
aws eks update-kubeconfig --name "$cluster" --region "$AWS_REGION" >/dev/null

log "Applying the GitOps bootstrap"
apply_root "$PLATFORM" -var api_alb_ready=false

app_healthy() {
  [ "$(kubectl -n argocd get application cashight \
    -o jsonpath='{.status.sync.status} {.status.health.status}' 2>/dev/null)" = "Synced Healthy" ]
}
log "Waiting for the cashight Application (add-ons first, then the workloads)"
wait_for 900 "Application cashight to be Synced and Healthy" app_healthy

alb_hostname() {
  [ -n "$(kubectl -n cashight get ingress cashight \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null)" ]
}
wait_for 600 "the cashight Ingress to get its ALB" alb_hostname

log "Pointing $API_HOST at the ALB"
apply_root "$PLATFORM" -var api_alb_ready=true

log "Checking the overlay against Terraform"
"$CHECK_OVERLAY" || die "the committed overlay differs from Terraform; fix it and push before testing"

dns_resolves() { [ -n "$(dig +short "$API_HOST")" ]; }
health_ok() { [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://$API_HOST/health")" = "200" ]; }
wait_for 300 "$API_HOST to resolve" dns_resolves
wait_for 300 "https://$API_HOST/health to answer 200" health_ok

log "Smoke tests"
repo_var() {
  local value=${!1:-}
  [ -n "$value" ] || value=$(gh variable get "$1")
  printf '%s' "$value"
}
pool_id=$(repo_var COGNITO_USER_POOL_ID)
client_id=$(repo_var COGNITO_SMOKE_CLIENT_ID)
hosted_ui=$(repo_var COGNITO_HOSTED_UI_DOMAIN)
# Client credentials on the smoke client, as in application-deploy.yaml: the
# API requires the cashight/* scopes. Neither the secret nor the token is printed.
secret=$(aws cognito-idp describe-user-pool-client --user-pool-id "$pool_id" --client-id "$client_id" \
  --query 'UserPoolClient.ClientSecret' --output text)
response=$(curl -sS -X POST "$hosted_ui/oauth2/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -u "$client_id:$secret" \
  -d 'grant_type=client_credentials&scope=cashight/read cashight/write')
token=$(jq -r '.access_token // empty' <<<"$response")
[ -n "$token" ] || die "could not mint a smoke token: $(jq -r '.error // "unknown_error"' <<<"$response")"
APP_URL=$APP_URL API_URL="https://$API_HOST" SMOKE_NATIVE_ACCESS_TOKEN=$token SMOKE_REQUIRE_NATIVE_AUTH=true \
  node scripts/smoke-serverless.mjs

log "Switching the Grafana uptime and telemetry alerts on"
terraform -chdir="$GRAFANA" init -input=false
apply_root "$GRAFANA" -var api_live=true -var collector_live=true

log "v2 is up: $APP_URL (API https://$API_HOST). Tear down with: bash scripts/platform/teardown.sh \"destroy cashight-v2\""
