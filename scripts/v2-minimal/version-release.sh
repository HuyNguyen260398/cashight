#!/usr/bin/env bash
# Versions a v2-minimal release in the runner's copy of the overlay, after
# pin-image.sh:
#   - stamps the pod-template annotation cashight.nghuy.link/app-version with
#     the commit, so every release (even a config-only one) rolls a new pod;
#   - renames ConfigMap cashight-env to cashight-env-<sha12> and points the
#     Deployment's envFrom at it. `kubectl apply` does not prune, so the
#     previous release's ConfigMap stays, and `kubectl rollout undo` brings
#     back the old pod together with the old config. prune-config.sh removes
#     ConfigMaps no ReplicaSet uses any more.
#
#   version-release.sh <overlay-dir> <commit-sha>
set -euo pipefail

[ "$#" -eq 2 ] || {
  echo "usage: $0 <overlay-dir> <commit-sha>" >&2
  exit 1
}
overlay=$1 sha=$2

[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "version-release: '$sha' is not a full commit SHA" >&2
  exit 1
}
for file in env.yaml deployment.yaml; do
  [ -f "$overlay/$file" ] || {
    echo "version-release: $overlay/$file not found" >&2
    exit 1
  }
done

NAME="cashight-env-${sha:0:12}" SHA=$sha yq -i '
  .spec.template.metadata.annotations."cashight.nghuy.link/app-version" = strenv(SHA)
  | (.spec.template.spec.containers[].envFrom[] | select(.configMapRef.name == "cashight-env")).configMapRef.name = strenv(NAME)
' "$overlay/deployment.yaml"
NAME="cashight-env-${sha:0:12}" yq -i '.metadata.name = strenv(NAME)' "$overlay/env.yaml"
echo "version-release: app-version $sha, ConfigMap cashight-env-${sha:0:12}"
