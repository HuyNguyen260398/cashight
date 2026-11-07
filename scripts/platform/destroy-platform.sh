#!/usr/bin/env bash
# Destroy the ephemeral v2 test cluster (terraform/platform). See
# docs/platform.md, Teardown.
#
# terraform/platform holds only the cluster and its GitOps bootstrap; the
# budget, the CodeConnections connection and the Identity Center group live in
# terraform/platform-base and survive. So this always destroys the bootstrap
# first, then everything else in the root.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

ROOT=terraform/platform

[ "${1:-}" = "destroy platform" ] || {
  echo 'Refusing: pass the literal argument "destroy platform".' >&2
  exit 2
}

refuse() {
  echo "Refusing: $1" >&2
  exit 1
}

# Only enforce the in-cluster guards while the cluster still exists. A partially
# destroyed platform must stay destroyable, but a stale kubeconfig must not be
# mistaken for "no workloads".
cluster_in_state=$(
  terraform -chdir="$ROOT" state list 2>/dev/null |
    grep -c 'module\.platform_cluster\.module\.eks\.aws_eks_cluster' || true
)

if [ "$cluster_in_state" != 0 ]; then
  kubectl get --raw /readyz >/dev/null 2>&1 ||
    refuse "the EKS cluster is still in state but kubectl cannot reach it.
  Fix your kubeconfig (docs/platform.md, Cluster access) so the workload guards
  can run, or remove the cluster from state deliberately."

  # Argo CD is optional (enable_argocd). Without it there is no Application CRD
  # and no Application to guard. An Application declares either a single
  # .spec.source or, for multi-source Applications, a .spec.sources array.
  # Checking only .spec.source.path leaves .spec.source null for a multi-source
  # workload, so the guard passes while the workload is live - and its
  # controller-created ALB then survives into the VPC destroy and blocks it.
  applications_json="$(kubectl -n argocd get applications -o json 2>/dev/null || echo '{"items":[]}')"
  #
  # The platform-workloads ApplicationSet always generates one app-of-apps
  # whose path is exactly deploy/workloads. It only blocks the teardown while it
  # still manages something (the workload Applications under deploy/workloads);
  # empty, it is part of the platform and is destroyed with it.
  workload_apps=$(
    printf '%s' "$applications_json" | jq -r '
      .items[]
      | ((.status.resources // []) | length > 0) as $manages
      | select(
          ([ .spec.source?.path? ] + [ (.spec.sources // [])[]?.path? ])
          | map(select(type == "string") | rtrimstr("/"))
          | any(
              startswith("deploy/cashight")
              or startswith("deploy/workloads/")
              or (. == "deploy/workloads" and $manages)
            )
        )
      | .metadata.name
    '
  )
  [ -z "$workload_apps" ] || refuse "workload Applications exist:
    ${workload_apps//$'\n'/$'\n'    }
  Delete them and let Argo CD prune their resources first."

  # Ingresses and LoadBalancer Services are backed by load balancers that the
  # aws-load-balancer-controller creates. Terraform has no record of them, so
  # destroying the cluster first orphans them, and the leftover ENIs and
  # security groups then fail the VPC destroy. Their finalizers only release the
  # AWS resources while the controller is still running.
  ingresses=$(
    kubectl get ingress -A -o json 2>/dev/null |
      jq -r '.items[] | "\(.metadata.namespace)/\(.metadata.name)"'
  )
  [ -z "$ingresses" ] || refuse "Ingress objects still exist:
    ${ingresses//$'\n'/$'\n'    }
  Delete them and wait for their load balancers to disappear first."

  lb_services=$(
    kubectl get svc -A -o json 2>/dev/null |
      jq -r '.items[] | select(.spec.type == "LoadBalancer") | "\(.metadata.namespace)/\(.metadata.name)"'
  )
  [ -z "$lb_services" ] || refuse "LoadBalancer Services still exist:
    ${lb_services//$'\n'/$'\n'    }
  Delete them and wait for their load balancers to disappear first."
fi

plan_dir="$(mktemp -d)"
trap 'rm -rf "$plan_dir"' EXIT
plan="$plan_dir/platform-destroy.tfplan"

# The bootstrap module goes first: its kubernetes provider is configured from the
# cluster endpoint, so it cannot be planned once the cluster is gone. With
# enable_argocd = false it has no instances and this is a no-op.
terraform -chdir="$ROOT" destroy \
  -target=module.platform_bootstrap -input=false

terraform -chdir="$ROOT" plan -destroy -out="$plan" -input=false
terraform -chdir="$ROOT" apply "$plan"
