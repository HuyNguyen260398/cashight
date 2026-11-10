#!/usr/bin/env bash
# Decides how the release reaches the API. Waits for the cashight Ingress to
# get its ALB and for the ALB's hostname to resolve. Then:
#   - the API hostname resolves: print nothing (check through DNS, as users do);
#   - it does not (first deploy: terraform/v2-minimal creates the record only
#     once the ALB exists): print the ALB hostname, so wait-revision.sh and the
#     smoke suite connect to it directly while keeping the API hostname for
#     TLS and the Host header.
# Exit 1 if the ALB never appears or never resolves.
#
#   api-endpoint.sh <api-host> [timeout-seconds=600]
set -euo pipefail

[ "$#" -ge 1 ] && [ "$#" -le 2 ] || {
  echo "usage: $0 <api-host> [timeout-seconds]" >&2
  exit 1
}
api_host=$1 timeout=${2:-600}
poll=${POLL_SECONDS:-10}
deadline=$((SECONDS + timeout))

alb=
until [ -n "$alb" ] && getent hosts "$alb" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "api-endpoint: the cashight Ingress has no resolvable ALB after ${timeout}s (hostname: '${alb:-none}')" >&2
    exit 1
  fi
  sleep "$poll"
  alb=$(kubectl get ingress cashight -n cashight \
    -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || true)
done

if getent hosts "$api_host" >/dev/null 2>&1; then
  echo "api-endpoint: $api_host resolves; checking through DNS" >&2
else
  echo "api-endpoint: $api_host has no DNS record yet; checking through $alb directly. Run scripts/v2-minimal/apply.sh after this release to create the record." >&2
  echo "$alb"
fi
