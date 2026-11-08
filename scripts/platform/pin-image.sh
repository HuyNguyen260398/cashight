#!/usr/bin/env bash
# Pins the cashight-backend image in a Kustomize overlay by digest and records
# the commit it was built from as APP_VERSION. Called by
# .github/workflows/v2-release.yaml after the push to ECR.
#
#   pin-image.sh <overlay-dir> <repo-url> <sha256:digest> <commit-sha>
#
# Validates everything before writing, so a bad argument leaves the overlay
# untouched. yq edits in place and keeps the comments.
set -euo pipefail

usage() {
  echo "usage: $0 <overlay-dir> <repo-url> <sha256:digest> <commit-sha>" >&2
  exit 1
}

[ "$#" -eq 4 ] || usage
overlay=$1 repo=$2 digest=$3 commit=$4

[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "pin-image: '$digest' is not a sha256 image digest" >&2
  exit 1
}
[[ "$commit" =~ ^[0-9a-f]{40}$ ]] || {
  echo "pin-image: '$commit' is not a full commit SHA" >&2
  exit 1
}
[[ "$repo" =~ ^[a-z0-9.-]+/[a-z0-9._/-]+$ ]] || {
  echo "pin-image: '$repo' is not an image repository" >&2
  exit 1
}
for file in kustomization.yaml env.yaml; do
  [ -f "$overlay/$file" ] || {
    echo "pin-image: $overlay/$file not found" >&2
    exit 1
  }
done

REPO=$repo DIGEST=$digest yq -i '
  (.images[] | select(.name == "cashight-backend")) |= (.newName = strenv(REPO) | .digest = strenv(DIGEST))
' "$overlay/kustomization.yaml"
COMMIT=$commit yq -i '.data.APP_VERSION = strenv(COMMIT)' "$overlay/env.yaml"
