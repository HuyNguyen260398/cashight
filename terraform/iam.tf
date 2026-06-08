# The statements-bucket RW policy. Attached to the Amplify *compute* role in
# amplify.tf (`aws_iam_role_policy_attachment.amplify_compute_s3`) — that is the
# identity the SSR runtime assumes at request time, not the build service role.
data "aws_iam_policy_document" "statements_rw" {
  statement {
    sid    = "ReadWriteStatements"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.statements.arn}/statements/*"]
  }

  statement {
    sid       = "ListBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.statements.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["statements/*", "statements/"]
    }
  }

  statement {
    sid    = "ReadRuntimeSecureParameters"
    effect = "Allow"
    actions = [
      "ssm:GetParameter",
    ]
    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/cashight/prod/GEMINI_API_KEY",
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/cashight/prod/PDF_PASSWORD",
    ]
  }
}

resource "aws_iam_policy" "statements_rw" {
  name        = "${var.project_name}-statements-rw"
  description = "Read/write access to the statements bucket"
  policy      = data.aws_iam_policy_document.statements_rw.json
}

data "aws_iam_policy_document" "amplify_service_logs" {
  statement {
    sid    = "AllowAmplifySSRCloudWatchLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:DescribeLogGroups",
      "logs:PutLogEvents",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "amplify_service_logs" {
  name        = "${var.project_name}-amplify-service-logs"
  description = "Allow Amplify SSR hosting to publish runtime logs to CloudWatch"
  policy      = data.aws_iam_policy_document.amplify_service_logs.json
}

output "statements_bucket_name" {
  value = aws_s3_bucket.statements.id
}

output "statements_policy_arn" {
  value = aws_iam_policy.statements_rw.arn
}
