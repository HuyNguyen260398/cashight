#!/usr/bin/env bash
# Tears v2 minimal down (terraform/v2, platform-base and Grafana stay):
#   1. switch the Grafana uptime alert off, so the planned downtime does not page;
#   2. delete the cashight Ingress while the load balancer controller still
#      runs, so it deletes the ALB;
#   3. wait until no k8s-cashight-* load balancer remains (a surviving ALB
#      keeps ENIs in the VPC and hangs the destroy);
#   4. destroy terraform/v2-minimal (cluster, Lambdas, DNS record);
#   5. hand releases back to v2-release.yaml (V2_TARGET=full).
# docs/v2-minimal.md, "Teardown".
#
# Test seams (scripts/__tests__/v2-minimal-scripts.test.ts): POLL_SECONDS,
# ALB_TIMEOUT_SECONDS.
set -euo pipefail

[ "${1:-}" = "destroy cashight-v2-min" ] || {
  echo 'Refusing: pass the literal argument "destroy cashight-v2-min".' >&2
  exit 1
}

cd "$(git rev-parse --show-toplevel)"

export AWS_REGION=${AWS_REGION:-ap-southeast-1}
POLL_SECONDS=${POLL_SECONDS:-15}
ALB_TIMEOUT_SECONDS=${ALB_TIMEOUT_SECONDS:-600}
ROOT=terraform/v2-minimal
GRAFANA=terraform/grafana

log() { echo "==> $*"; }

plan_dir=$(mktemp -d)
trap 'rm -rf "$plan_dir"' EXIT

log "Switching the Grafana uptime alert off"
terraform -chdir="$GRAFANA" init -input=false
terraform -chdir="$GRAFANA" plan -input=false -var api_live=false -var collector_live=false -out="$plan_dir/grafana.tfplan"
terraform -chdir="$GRAFANA" apply -input=false "$plan_dir/grafana.tfplan"

if aws eks update-kubeconfig --name cashight-v2-min --region "$AWS_REGION" >/dev/null 2>&1 &&
  kubectl get --raw /readyz >/dev/null 2>&1; then
  log "Deleting the cashight Ingress (the controller deletes its ALB)"
  kubectl delete ingress cashight -n cashight --ignore-not-found --wait=true --timeout=5m
else
  log "No reachable cluster; skipping the Ingress cleanup"
fi

# Only one of the two v2 clusters ever exists, so the name prefix is enough.
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

log "Destroying terraform/v2-minimal"
terraform -chdir="$ROOT" init -input=false
terraform -chdir="$ROOT" plan -destroy -input=false -out="$plan_dir/destroy.tfplan"
terraform -chdir="$ROOT" apply -input=false "$plan_dir/destroy.tfplan"

log "Handing releases back to v2-release.yaml (V2_TARGET=full)"
gh variable set V2_TARGET --body full

log "Torn down. terraform/v2, platform-base and Grafana remain."
