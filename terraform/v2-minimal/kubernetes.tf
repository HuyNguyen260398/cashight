# In-cluster bootstrap that Argo CD did on the full platform. Cluster-scoped
# objects live here because the CI role's namespace-scoped edit access cannot
# create them (spec §4.3).

resource "kubernetes_namespace_v1" "cashight" {
  metadata {
    name = "cashight"
    # The load balancer controller injects its readiness gate into pods here:
    # a new pod counts as Ready only once its ALB target is healthy, so with
    # one replica the old pod keeps serving until the ALB can reach the new one.
    labels = { "elbv2.k8s.aws/pod-readiness-gate-inject" = "enabled" }
  }

  depends_on = [module.cluster]
}

resource "kubernetes_namespace_v1" "aws_observability" {
  metadata {
    name   = "aws-observability"
    labels = { "aws-observability" = "enabled" }
  }

  depends_on = [module.cluster]
}

# Fargate bills each pod at its requests; a pod without requests must not land
# on a large size by accident.
resource "kubernetes_limit_range_v1" "cashight_defaults" {
  metadata {
    name      = "cashight-defaults"
    namespace = kubernetes_namespace_v1.cashight.metadata[0].name
  }

  spec {
    limit {
      type            = "Container"
      default         = { cpu = "250m", memory = "512Mi" }
      default_request = { cpu = "250m", memory = "512Mi" }
      max             = { memory = "2Gi" }
    }
  }
}

# Fargate's built-in Fluent Bit. Only the cashight namespace ships (spec
# decision 3); kube-system logs are deliberately dropped.
resource "kubernetes_config_map_v1" "aws_logging" {
  metadata {
    name      = "aws-logging"
    namespace = kubernetes_namespace_v1.aws_observability.metadata[0].name
  }

  data = {
    flb_log_cw = "false"

    "filters.conf" = <<-EOT
      [FILTER]
          Name                kubernetes
          Match               kube.*
          Merge_Log           On
          Buffer_Size         0
          Kube_Meta_Cache_TTL 300s

      [FILTER]
          Name    grep
          Match   kube.*
          Regex   $kubernetes['namespace_name'] ^cashight$
    EOT

    "output.conf" = <<-EOT
      [OUTPUT]
          Name              cloudwatch_logs
          Match             kube.*
          region            ${var.aws_region}
          log_group_name    ${aws_cloudwatch_log_group.app.name}
          log_stream_prefix fargate-
          auto_create_group false
    EOT
  }
}

locals {
  # vpcId and region are explicit: Fargate has no IMDS to discover them.
  lbc_values = {
    clusterName  = module.cluster.cluster_name
    region       = var.aws_region
    vpcId        = module.cluster.vpc_id
    replicaCount = 1
    serviceAccount = {
      name        = "aws-load-balancer-controller"
      annotations = { "eks.amazonaws.com/role-arn" = module.cluster.load_balancer_controller_role_arn }
    }
    # Tags every AWS resource the controller creates (the ALB, its target
    # group and security groups), so the v2-minimal tag budget sees them.
    defaultTags  = local.tags
    enableShield = false
    enableWaf    = false
    enableWafv2  = false
    resources = {
      requests = { cpu = "250m", memory = "256Mi" }
      limits   = { memory = "256Mi" }
    }
  }
}

resource "helm_release" "aws_load_balancer_controller" {
  name       = "aws-load-balancer-controller"
  namespace  = "kube-system"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  version    = var.lbc_chart_version

  values = [yamlencode(local.lbc_values)]

  depends_on = [module.cluster]
}
