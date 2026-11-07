#!/usr/bin/env bash
# Guards the GitOps tree Argo CD reads from this repository. An Application
# whose path still points at the old gitops/ layout sits in ComparisonError on
# first bring-up, and nothing else catches it before a cluster exists.
#
# Fails (exit 1, naming file:line) when:
#   (a) any file under deploy/ mentions gitops/ or the old platform repository
#       (matched as aws-eks-[i]nfra so this file does not name it);
#   (b) a path: in deploy/platform/bootstrap/*.yaml or
#       deploy/platform/config/addons/*.yaml does not start with deploy/
#       (Helm-chart-internal paths are allowlisted by exact string);
#   (c) deploy/workloads/ does not exist.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

allowed_paths=(
  "/var/log/pods"
  "../../config/namespaces/values.yaml"
)

failures=0
fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

if [ ! -d deploy/workloads ]; then
  fail "(c) deploy/workloads/ does not exist"
fi

if [ -d deploy ]; then
  while IFS= read -r hit; do
    fail "(a) $hit"
  done < <(grep -rnE 'gitops/|aws-eks-[i]nfra' deploy || true)
fi

shopt -s nullglob
for file in deploy/platform/bootstrap/*.yaml deploy/platform/config/addons/*.yaml; do
  while IFS= read -r line; do
    lineno=${line%%:*}
    value=$(sed -E 's/^[[:space:]]*(-[[:space:]]+)?path:[[:space:]]*//; s/^["'\'']//; s/["'\'']$//' <<<"${line#*:}")
    allowed=false
    for ok in "${allowed_paths[@]}"; do
      [ "$value" = "$ok" ] && allowed=true
    done
    if [ "$allowed" = false ] && [[ "$value" != deploy/* ]]; then
      fail "(b) $file:$lineno: path '$value' does not start with deploy/"
    fi
  done < <(grep -nE '^[[:space:]]*(-[[:space:]]+)?path:' "$file" || true)
done

if [ "$failures" -gt 0 ]; then
  echo "check-deploy-paths: $failures problem(s)" >&2
  exit 1
fi
echo "check-deploy-paths: PASS"
