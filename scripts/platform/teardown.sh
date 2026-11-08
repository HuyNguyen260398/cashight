#!/usr/bin/env bash
# Tears the v2 test environment down to its persistent pieces (terraform/v2,
# platform-base and Grafana stay):
#   1. switch the Grafana uptime and telemetry alerts off, so the planned
#      downtime does not page;
#   2. delete the platform-workloads ApplicationSet, so nothing regenerates the
#      Cashight Application, then delete the Application. Its finalizer prunes
#      the workloads, including the Ingress, and the load balancer controller
#      deletes the ALB while it still runs;
#   3. wait until no k8s-cashight-* load balancer remains (a surviving ALB
#      keeps ENIs in the VPC and hangs the destroy);
#   4. destroy the cluster root with destroy-platform.sh, which also removes
#      the api.cashight-v2.nghuy.link record.
# docs/platform.md, "Test day: teardown".
#
# Test seams (scripts/__tests__/platform-scripts.test.ts): DESTROY_PLATFORM,
# POLL_SECONDS, ALB_TIMEOUT_SECONDS.
set -euo pipefail

[ "${1:-}" = "destroy cashight-v2" ] || {
  echo 'Refusing: pass the literal argument "destroy cashight-v2".' >&2
  exit 2
}

cd "$(git rev-parse --show-toplevel)"

export AWS_REGION=${AWS_REGION:-ap-southeast-1}
DESTROY_PLATFORM=${DESTROY_PLATFORM:-scripts/platform/destroy-platform.sh}
POLL_SECONDS=${POLL_SECONDS:-15}
ALB_TIMEOUT_SECONDS=${ALB_TIMEOUT_SECONDS:-600}
GRAFANA=terraform/grafana

log() { echo "==> $*"; }

plan_dir=$(mktemp -d)
trap 'rm -rf "$plan_dir"' EXIT

log "Switching the Grafana uptime and telemetry alerts off"
terraform -chdir="$GRAFANA" init -input=false
terraform -chdir="$GRAFANA" plan -input=false -var api_live=false -var collector_live=false -out="$plan_dir/grafana.tfplan"
terraform -chdir="$GRAFANA" apply -input=false "$plan_dir/grafana.tfplan"

if aws eks update-kubeconfig --name cashight-v2 --region "$AWS_REGION" >/dev/null 2>&1 &&
  kubectl get --raw /readyz >/dev/null 2>&1; then
  log "Removing the Cashight workloads"
  kubectl -n argocd delete applicationset platform-workloads --ignore-not-found --wait=true
  # Blocks until the finalizer has pruned everything the Application manages.
  kubectl -n argocd delete application cashight --ignore-not-found --wait=true --timeout=15m
else
  log "No reachable cluster; skipping the workload cleanup"
fi

cashight_albs() {
  aws elbv2 describe-load-balancers \
    --query "LoadBalancers[?starts_with(LoadBalancerName, 'k8s-cashight-')].LoadBalancerName" \
    --output text
}
log "Waiting for the cashight load balancer to disappear"
waited=0
while :; do
  remaining=$(cashight_albs)
  [ -n "$remaining" ] && [ "$remaining" != "None" ] || break
  if [ "$waited" -ge "$ALB_TIMEOUT_SECONDS" ]; then
    echo "teardown: load balancer(s) still present after ${ALB_TIMEOUT_SECONDS}s: $remaining" >&2
    echo "  Check the aws-load-balancer-controller logs, or delete them by hand, then re-run." >&2
    exit 1
  fi
  sleep "$POLL_SECONDS"
  waited=$((waited + (POLL_SECONDS > 0 ? POLL_SECONDS : 1)))
done

log "Destroying the cluster root"
"$DESTROY_PLATFORM" "destroy platform"

log "Torn down. terraform/v2, platform-base and Grafana remain."
