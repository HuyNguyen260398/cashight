data "aws_iam_policy_document" "observability_kms" {
  #checkov:skip=CKV_AWS_109: The account-root KMS administration statement is the AWS-recommended default key-policy baseline.
  #checkov:skip=CKV_AWS_111: The account-root KMS administration statement intentionally grants write-capable key management.
  #checkov:skip=CKV_AWS_356: KMS key policies require wildcard resources because KMS keys do not support resource ARNs here.
  statement {
    sid    = "EnableAccountRootAdministration"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"]
    }

    actions   = ["kms:*"]
    resources = ["*"]
  }

  statement {
    sid    = "AllowCloudWatchLogsEncryption"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }

    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = ["*"]

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values = [
        "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/eks/${local.cluster_name}/*",
      ]
    }
  }
}

resource "aws_kms_key" "observability" {
  description             = "KMS key for ${local.cluster_name} observability logs"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.observability_kms.json

  tags = var.tags
}

# The control-plane log group /aws/eks/<cluster>/cluster is created by the EKS
# module itself, wired to aws_kms_key.observability in eks.tf. Declaring it here
# as well would collide on the same AWS name, and ordering it with a module-level
# depends_on defers every data source inside the EKS module to apply time.
