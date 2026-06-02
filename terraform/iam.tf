variable "amplify_service_role_name" {
  type        = string
  description = "Name of the Amplify Hosting compute/service role to grant statements-bucket access. Obtain this after creating the Amplify app in the console (App settings → IAM role). Leave empty to skip the attachment."
  default     = ""
}

data "aws_iam_policy_document" "statements_rw" {
  statement {
    sid    = "ReadWriteStatements"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.statements.arn}/*"]
  }

  statement {
    sid       = "ListBucket"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.statements.arn]
  }
}

resource "aws_iam_policy" "statements_rw" {
  name        = "${var.project_name}-statements-rw"
  description = "Read/write access to the statements bucket"
  policy      = data.aws_iam_policy_document.statements_rw.json
}

resource "aws_iam_role_policy_attachment" "amplify_s3" {
  count      = var.amplify_service_role_name != "" ? 1 : 0
  role       = var.amplify_service_role_name
  policy_arn = aws_iam_policy.statements_rw.arn
}

output "statements_bucket_name" {
  value = aws_s3_bucket.statements.id
}

output "statements_policy_arn" {
  value = aws_iam_policy.statements_rw.arn
}
