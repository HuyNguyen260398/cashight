#!/usr/bin/env bash
# Appends `deployment=<revision>` for deployment/cashight-api to the release's
# rollback state file, before the release changes anything. rollback.sh undoes
# to exactly this revision, so a release that failed before `kubectl apply`
# never rolls a healthy deployment back. On the first deploy there is no
# deployment, and nothing is recorded.
#
#   record-revision.sh <state-file>
set -euo pipefail

[ "$#" -eq 1 ] || {
  echo "usage: $0 <state-file>" >&2
  exit 1
}
state=$1

revision=$(kubectl get deployment cashight-api -n cashight \
  -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}' 2>/dev/null || true)
if [[ "$revision" =~ ^[0-9]+$ ]]; then
  echo "deployment=$revision" >>"$state"
  echo "record-revision: deployment/cashight-api is at revision $revision"
else
  echo "record-revision: no previous revision of deployment/cashight-api (first deploy)"
fi
