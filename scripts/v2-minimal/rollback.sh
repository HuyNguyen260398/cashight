#!/usr/bin/env bash
# Restores what a failed v2-minimal release changed, then fails the job:
#   - deployment/cashight-api back to the revision record-revision.sh noted,
#     if it moved (nothing to undo on the first deploy);
#   - each worker's `live` alias back to the version deploy-workers.sh noted.
# Every step runs even when an earlier one errors. Always exits 1.
#
#   rollback.sh <state-file>
set -uo pipefail

[ "$#" -eq 1 ] || {
  echo "usage: $0 <state-file>" >&2
  exit 1
}
state=$1
[ -f "$state" ] || state=/dev/null

log() { echo "rollback: $*"; }

recorded=$(sed -n 's/^deployment=\([0-9][0-9]*\)$/\1/p' "$state" | tail -n 1)
current=$(kubectl get deployment cashight-api -n cashight \
  -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}' 2>/dev/null)

if [ -z "$recorded" ]; then
  log "no previous revision of deployment/cashight-api to roll back to (first deploy); skipping rollout undo"
elif [ "$current" = "$recorded" ]; then
  log "deployment/cashight-api unchanged at revision $recorded; skipping rollout undo"
else
  log "undoing deployment/cashight-api from revision ${current:-unknown} to $recorded"
  if kubectl rollout undo deployment/cashight-api -n cashight --to-revision="$recorded"; then
    kubectl rollout status deployment/cashight-api -n cashight --timeout=5m ||
      log "rollout status did not report success after the undo"
  else
    log "rollout undo failed"
  fi
fi

aliases=0
while IFS='=' read -r function version; do
  case "$function" in
    cashight-v2-*) ;;
    *) continue ;;
  esac
  aliases=$((aliases + 1))
  log "pointing $function live back at version $version"
  aws lambda update-alias --function-name "$function" --name live --function-version "$version" >/dev/null ||
    log "could not restore $function live"
done <"$state"
[ "$aliases" -gt 0 ] || log "no recorded Lambda alias versions; skipping alias restore"

log "release failed and was rolled back"
exit 1
