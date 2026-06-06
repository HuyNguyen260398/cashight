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

output "statements_bucket_name" {
  value = aws_s3_bucket.statements.id
}

output "statements_policy_arn" {
  value = aws_iam_policy.statements_rw.arn
}
