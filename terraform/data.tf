# terraform/data.tf — DynamoDB table, uploads S3 bucket, SQS queues

# ── DynamoDB ─────────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "cashight" {
  name         = "cashight"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "expiresAtEpoch"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = true
  }

  deletion_protection_enabled = true

  server_side_encryption {
    enabled = true
  }

  tags = {
    Project = var.project_name
    Name    = "cashight"
  }
}

# ── Uploads S3 bucket ─────────────────────────────────────────────────────────

resource "aws_s3_bucket" "uploads" {
  bucket = "cashight-uploads-${data.aws_caller_identity.current.account_id}"
  tags   = { Project = var.project_name }
}

resource "aws_s3_bucket_public_access_block" "uploads" {
  bucket                  = aws_s3_bucket.uploads.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  rule {
    id     = "expire-uploads"
    status = "Enabled"
    filter {
      prefix = "uploads/"
    }

    expiration {
      days = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["PUT"]
    allowed_origins = [
      "https://cashight.nghuy.link",
      "https://next.cashight.nghuy.link",
      "http://localhost:3000",
    ]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

data "aws_iam_policy_document" "uploads_deny_insecure" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.uploads.arn,
      "${aws_s3_bucket.uploads.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "uploads" {
  bucket     = aws_s3_bucket.uploads.id
  policy     = data.aws_iam_policy_document.uploads_deny_insecure.json
  depends_on = [aws_s3_bucket_public_access_block.uploads]
}

# ── Private Cost Explorer CSV exports ─────────────────────────────────────────

resource "aws_s3_bucket" "cost_exports" {
  #checkov:skip=CKV_AWS_18:One-day presigned exports are audited through the API and Lambda logs; a dedicated access-log bucket would add persistent financial metadata and cost.
  #checkov:skip=CKV_AWS_21:Exports are deliberately ephemeral and expire after one day; versioning would retain deleted financial CSVs.
  #checkov:skip=CKV_AWS_144:One-day exports are recreated on demand; cross-region replication would retain extra copies and add cost without a recovery requirement.
  #checkov:skip=CKV_AWS_145:Repository-standard AES256 encryption is sufficient for short-lived exports and avoids a dedicated KMS key and request charges.
  #checkov:skip=CKV2_AWS_62:Export objects are consumed by presigned GET only and have no event-driven downstream workflow.
  bucket = "cashight-cost-exports-${data.aws_caller_identity.current.account_id}"
  tags = {
    Project = var.project_name
    Name    = "cashight-cost-exports"
  }
}

resource "aws_s3_bucket_public_access_block" "cost_exports" {
  bucket                  = aws_s3_bucket.cost_exports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "cost_exports" {
  bucket = aws_s3_bucket.cost_exports.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cost_exports" {
  bucket = aws_s3_bucket.cost_exports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "cost_exports" {
  bucket = aws_s3_bucket.cost_exports.id

  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "cost_exports" {
  bucket = aws_s3_bucket.cost_exports.id

  rule {
    id     = "expire-cost-exports"
    status = "Enabled"

    filter {
      prefix = "exports/"
    }

    expiration {
      days = 1
    }

  }

  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "cost_exports" {
  bucket = aws_s3_bucket.cost_exports.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET"]
    allowed_origins = ["https://cashight.nghuy.link"]
    expose_headers  = ["ETag"]
    max_age_seconds = 300
  }
}

data "aws_iam_policy_document" "cost_exports_deny_insecure" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.cost_exports.arn,
      "${aws_s3_bucket.cost_exports.arn}/*",
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "cost_exports" {
  bucket     = aws_s3_bucket.cost_exports.id
  policy     = data.aws_iam_policy_document.cost_exports_deny_insecure.json
  depends_on = [aws_s3_bucket_public_access_block.cost_exports]
}

# ── SQS queues ────────────────────────────────────────────────────────────────

resource "aws_sqs_queue" "parse_dlq" {
  name                      = "cashight-parse-dlq"
  message_retention_seconds = 14 * 24 * 3600 # 14 days = 1 209 600 s
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "parse" {
  name                       = "cashight-parse"
  visibility_timeout_seconds = 360
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.parse_dlq.arn
    maxReceiveCount     = 3
  })
}

data "aws_iam_policy_document" "parse_queue_policy" {
  statement {
    sid     = "AllowS3SendMessage"
    effect  = "Allow"
    actions = ["sqs:SendMessage"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    resources = [aws_sqs_queue.parse.arn]
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.uploads.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "parse" {
  queue_url = aws_sqs_queue.parse.id
  policy    = data.aws_iam_policy_document.parse_queue_policy.json
}

resource "aws_sqs_queue" "invoice_parse_dlq" {
  name                      = "cashight-invoice-parse-dlq"
  message_retention_seconds = 14 * 24 * 3600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "invoice_parse" {
  name                       = "cashight-invoice-parse"
  visibility_timeout_seconds = 360
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.invoice_parse_dlq.arn
    maxReceiveCount     = 3
  })
}

data "aws_iam_policy_document" "invoice_parse_queue_policy" {
  statement {
    sid     = "AllowS3SendMessage"
    effect  = "Allow"
    actions = ["sqs:SendMessage"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
    resources = [aws_sqs_queue.invoice_parse.arn]
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = [aws_s3_bucket.uploads.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_sqs_queue_policy" "invoice_parse" {
  queue_url = aws_sqs_queue.invoice_parse.id
  policy    = data.aws_iam_policy_document.invoice_parse_queue_policy.json
}

# ── S3 bucket notification → SQS ─────────────────────────────────────────────

resource "aws_s3_bucket_notification" "uploads" {
  bucket = aws_s3_bucket.uploads.id

  queue {
    queue_arn     = aws_sqs_queue.parse.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "uploads/statements/"
    filter_suffix = ".pdf"
  }

  queue {
    queue_arn     = aws_sqs_queue.invoice_parse.arn
    events        = ["s3:ObjectCreated:*"]
    filter_prefix = "uploads/aws-invoices/"
    filter_suffix = ".pdf"
  }

  depends_on = [
    aws_sqs_queue_policy.parse,
    aws_sqs_queue_policy.invoice_parse,
  ]
}
