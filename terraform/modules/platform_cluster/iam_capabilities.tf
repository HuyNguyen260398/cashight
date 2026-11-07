data "aws_iam_policy_document" "capability_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["capabilities.eks.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "argocd_codeconnections" {
  statement {
    effect = "Allow"
    actions = [
      "codeconnections:GetConnection",
      "codeconnections:UseConnection",
    ]
    resources = [var.github_connection_arn]
  }
}

resource "aws_iam_role" "argocd_capability" {
  count = var.enable_argocd ? 1 : 0

  name               = "${local.cluster_name}-argocd-capability"
  assume_role_policy = data.aws_iam_policy_document.capability_assume_role.json

  tags = var.tags
}

resource "aws_iam_role_policy" "argocd_codeconnections" {
  count = var.enable_argocd ? 1 : 0

  name   = "${local.cluster_name}-argocd-codeconnections"
  role   = aws_iam_role.argocd_capability[0].id
  policy = data.aws_iam_policy_document.argocd_codeconnections.json
}
