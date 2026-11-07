module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 21.0"

  name                                     = local.cluster_name
  kubernetes_version                       = var.kubernetes_version
  authentication_mode                      = "API"
  endpoint_private_access                  = true
  endpoint_public_access                   = true
  endpoint_public_access_cidrs             = var.public_access_cidrs
  enable_irsa                              = true
  enable_cluster_creator_admin_permissions = true
  # Audit and authenticator only: the other control-plane streams are high
  # volume and rarely read for a single-tenant cluster.
  enabled_log_types = ["audit", "authenticator"]

  cloudwatch_log_group_retention_in_days = 30
  cloudwatch_log_group_kms_key_id        = aws_kms_key.observability.arn

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  compute_config = {
    enabled = false
  }

  # vpc-cni, kube-proxy and the Pod Identity Agent are created before the node
  # group (before_compute): the module builds the cluster with
  # bootstrap_self_managed_addons = false, so without them the node never
  # becomes Ready. enableNetworkPolicy makes the VPC CNI enforce NetworkPolicy
  # objects; without it they are accepted and silently ignored. Prefix
  # delegation hands each ENI /28 prefixes instead of single IPs, which lifts
  # the per-node Pod limit of small instances (17 on a t4g.medium) to the
  # maxPods set on the node group below.
  addons = {
    vpc-cni = {
      before_compute = true
      configuration_values = jsonencode({
        enableNetworkPolicy = "true"
        env = {
          ENABLE_PREFIX_DELEGATION = "true"
          WARM_PREFIX_TARGET       = "1"
        }
      })
    }
    kube-proxy = {
      before_compute = true
    }
    eks-pod-identity-agent = {
      before_compute = true
    }
    coredns = {}
  }

  # Two on-demand Graviton nodes run the platform controllers and Cashight
  # for a test day; the cluster is torn down afterwards (docs/platform.md).
  # Any extra instance types must be the same size (a check in locals.tf
  # warns otherwise). No cluster autoscaler: KEDA scales Pods, not nodes.
  #
  # The node sits in a public subnet with a public IPv4 address, so it reaches
  # AWS APIs, ECR and the internet without a NAT gateway. Inbound traffic is
  # still limited by the node security group; nothing listens publicly except
  # through the ALB. The launch template defaults to IMDSv2 with a hop limit
  # of 1, so Pods cannot reach the node role's credentials.
  eks_managed_node_groups = {
    general = {
      name            = "${local.cluster_name}-general"
      use_name_prefix = false
      # The module's default role name ("<name>-eks-node-group" as a prefix)
      # exceeds IAM's 38-character name_prefix limit.
      iam_role_name            = "${local.cluster_name}-node"
      iam_role_use_name_prefix = false

      ami_type       = "AL2023_ARM_64_STANDARD"
      instance_types = var.node_instance_types
      capacity_type  = var.node_capacity_type
      subnet_ids     = module.vpc.public_subnets

      min_size     = var.node_count
      max_size     = var.node_count
      desired_size = var.node_count

      # With prefix delegation the IP limit no longer caps Pods per node, so
      # set the kubelet ceiling explicitly. 110 is the upstream default and
      # the value AWS recommends for instances under 30 vCPUs.
      cloudinit_pre_nodeadm = [{
        content_type = "application/node.eks.aws"
        content      = <<-EOT
          ---
          apiVersion: node.eks.aws/v1alpha1
          kind: NodeConfig
          spec:
            kubelet:
              config:
                maxPods: 110
        EOT
      }]

      block_device_mappings = {
        xvda = {
          device_name = "/dev/xvda"
          ebs = {
            volume_size           = 20
            volume_type           = "gp3"
            encrypted             = true
            delete_on_termination = true
          }
        }
      }

      update_config = {
        max_unavailable = 1
      }

      node_repair_config = {
        enabled = true
      }
    }
  }

  tags = var.tags
}
