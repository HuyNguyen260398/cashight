#!/usr/bin/env bash
# Deletes the per-release cashight-env-<sha> ConfigMaps (version-release.sh)
# that no cashight-api ReplicaSet references any more. Run after a successful
# release; the Deployment keeps 3 old ReplicaSets, and with them exactly the
# ConfigMaps a `kubectl rollout undo` could need. Deletes nothing if it cannot
# see any reference, rather than guessing.
set -euo pipefail

referenced=$(kubectl get rs -n cashight -l app.kubernetes.io/name=cashight-api \
  -o jsonpath='{range .items[*]}{range .spec.template.spec.containers[*].envFrom[*]}{.configMapRef.name}{"\n"}{end}{end}')
existing=$(kubectl get configmap -n cashight -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}')

if ! grep -q . <<<"$referenced"; then
  echo "prune-config: no ReplicaSet references a ConfigMap; deleting nothing"
  exit 0
fi

while IFS= read -r name; do
  [[ "$name" =~ ^cashight-env-[0-9a-f]+$ ]] || continue
  grep -qxF "$name" <<<"$referenced" && continue
  echo "prune-config: deleting unused ConfigMap $name"
  kubectl delete configmap "$name" -n cashight --ignore-not-found
done <<<"$existing"
