data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "fargate_pod_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["eks-fargate-pods.amazonaws.com"]
    }

    # Only this cluster's Fargate profiles may use the role (confused deputy).
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values = [
        "arn:aws:eks:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:fargateprofile/${var.cluster_name}/*",
      ]
    }
  }
}

# One pod execution role shared by both profiles: it only pulls images and
# ships logs; pods get their AWS permissions from IRSA.
resource "aws_iam_role" "fargate_pod" {
  name               = "${var.cluster_name}-fargate-pod"
  assume_role_policy = data.aws_iam_policy_document.fargate_pod_assume_role.json

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "fargate_pod_execution" {
  role       = aws_iam_role.fargate_pod.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSFargatePodExecutionRolePolicy"
}

resource "aws_iam_role_policy" "fargate_pod_logging" {
  name   = "fargate-logging"
  role   = aws_iam_role.fargate_pod.id
  policy = var.fargate_log_policy_json
}
