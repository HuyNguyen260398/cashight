# EKS Pod Identity roles, served by the Pod Identity Agent on the node.
# The source conditions stop another account's or cluster's Pod Identity
# agent from assuming these roles (confused deputy).

data "aws_iam_policy_document" "pod_identity_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [module.eks.cluster_arn]
    }
  }
}

# KEDA reads queue depth on behalf of each ScaledObject by assuming the role
# that ScaledObject's TriggerAuthentication names. This role can only assume
# other roles; what it may read is decided by each target role's trust policy,
# which must name this role's ARN.
data "aws_iam_policy_document" "keda_operator" {
  statement {
    sid       = "AssumeScalerRoles"
    effect    = "Allow"
    actions   = ["sts:AssumeRole", "sts:TagSession"]
    resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/*"]
  }
}

resource "aws_iam_role" "keda_operator" {
  name               = "${local.cluster_name}-keda-operator"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume_role.json

  tags = var.tags
}

resource "aws_iam_role_policy" "keda_operator" {
  name   = "${local.cluster_name}-keda-operator"
  role   = aws_iam_role.keda_operator.id
  policy = data.aws_iam_policy_document.keda_operator.json
}

# The association may exist before the namespace or ServiceAccount does; it
# takes effect for Pods started after both exist.
resource "aws_eks_pod_identity_association" "keda_operator" {
  cluster_name    = module.eks.cluster_name
  namespace       = "keda"
  service_account = "keda-operator"
  role_arn        = aws_iam_role.keda_operator.arn

  tags = var.tags
}

# The OpenTelemetry Collector's init container reads the Grafana Cloud OTLP
# endpoint, instance ID and write token from SSM into a memory-backed volume.
# The SecureString is created by hand (docs/observability.md), so its
# value never enters Terraform state. Parameters encrypted with the AWS-managed
# aws/ssm key are decrypted through SSM only.
data "aws_iam_policy_document" "otel_collector" {
  statement {
    sid       = "ReadGrafanaCloudParameters"
    effect    = "Allow"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter${var.grafana_cloud_parameter_path}/*"]
  }

  statement {
    sid       = "DecryptViaSsm"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["arn:aws:kms:${var.aws_region}:${data.aws_caller_identity.current.account_id}:key/*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.${var.aws_region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "otel_collector" {
  name               = "${local.cluster_name}-otel-collector"
  assume_role_policy = data.aws_iam_policy_document.pod_identity_assume_role.json

  tags = var.tags
}

resource "aws_iam_role_policy" "otel_collector" {
  name   = "${local.cluster_name}-otel-collector"
  role   = aws_iam_role.otel_collector.id
  policy = data.aws_iam_policy_document.otel_collector.json
}

resource "aws_eks_pod_identity_association" "otel_collector" {
  cluster_name    = module.eks.cluster_name
  namespace       = "observability"
  service_account = "otel-collector"
  role_arn        = aws_iam_role.otel_collector.arn

  tags = var.tags
}
