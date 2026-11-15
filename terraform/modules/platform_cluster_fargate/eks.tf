locals {
  # Auto-upgrade at the end of standard support instead of billing extended
  # support ($0.60/h instead of $0.10/h).
  upgrade_policy = {
    support_type = "STANDARD"
  }
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.0"

  name                    = var.cluster_name
  kubernetes_version      = var.kubernetes_version
  authentication_mode     = "API"
  endpoint_private_access = true
  endpoint_public_access  = true
  # Open on purpose (spec §6.2): GitHub-hosted runners have no fixed IPs and
  # the endpoint allows at most 40 CIDRs. IAM authentication plus the access
  # entries below are the gate; CI only gets namespace-scoped edit.
  endpoint_public_access_cidrs = ["0.0.0.0/0"]
  enable_irsa                  = true
  # Admin access is granted explicitly through admin_principal_arns.
  enable_cluster_creator_admin_permissions = false

  # Control-plane logging off and the AWS-owned key for secrets encryption:
  # cost, for a single-user app (spec §4.2).
  enabled_log_types           = []
  create_cloudwatch_log_group = false
  create_kms_key              = false
  encryption_config           = null

  upgrade_policy = local.upgrade_policy

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  compute_config = {
    enabled = false
  }

  # No nodes, so no node security group. Fargate pods use the cluster's
  # primary security group.
  create_node_security_group = false

  # CoreDNS is the only add-on: Fargate supplies pod networking and service
  # routing itself, so vpc-cni, kube-proxy and the Pod Identity agent (which
  # Fargate does not support) are left out. The module creates add-ons after
  # the Fargate profiles, so CoreDNS has somewhere to schedule.
  addons = {
    coredns = {
      configuration_values = jsonencode({
        computeType  = "Fargate"
        replicaCount = 1
      })
    }
  }

  fargate_profiles = {
    kube-system = {
      name            = "kube-system"
      subnet_ids      = module.vpc.private_subnets
      selectors       = [{ namespace = "kube-system" }]
      create_iam_role = false
      iam_role_arn    = aws_iam_role.fargate_pod.arn
    }
    cashight = {
      name            = "cashight"
      subnet_ids      = module.vpc.private_subnets
      selectors       = [{ namespace = "cashight" }]
      create_iam_role = false
      iam_role_arn    = aws_iam_role.fargate_pod.arn
    }
  }

  access_entries = merge(
    {
      for index, arn in var.admin_principal_arns : "admin-${index}" => {
        principal_arn = arn
        policy_associations = {
          admin = {
            policy_arn   = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
            access_scope = { type = "cluster" }
          }
        }
      }
    },
    {
      ci = {
        principal_arn = var.ci_role_arn
        policy_associations = {
          edit = {
            policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSEditPolicy"
            access_scope = {
              type       = "namespace"
              namespaces = ["cashight"]
            }
          }
        }
      }
    },
  )

  tags = var.tags
}
