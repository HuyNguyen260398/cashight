# Step 06 — S3 Infrastructure (Terraform)

> Provision the S3 bucket that stores parsed statements, plus the IAM policy the Amplify Lambda role needs.

**Estimated effort:** 1–2 hours
**Prerequisites:** Step 05
**Phase:** 2 — Persistence

---

## Goal

A private S3 bucket exists in `ap-southeast-1`, with proper encryption, versioning, and lifecycle policies. Terraform-managed so the infrastructure is reproducible.

## Tasks

### Decide on the Terraform location

Two reasonable options:
- **Option A:** A `terraform/` subdirectory inside the `expense-tracker` repo (simplest, recommended for solo project)
- **Option B:** Add to your existing Terraform modules repo (better long-term, more friction now)

Pick A for now; you can extract to B later.

### Create the Terraform configuration

**`terraform/main.tf`:**

```hcl
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Optional: configure remote state
  # backend "s3" { ... }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "project_name" {
  type    = string
  default = "expense-tracker"
}

variable "bucket_suffix" {
  type        = string
  description = "Random suffix to ensure global uniqueness"
}
```

**`terraform/s3.tf`:**

```hcl
resource "aws_s3_bucket" "statements" {
  bucket = "${var.project_name}-statements-${var.bucket_suffix}"
  tags = {
    Project = var.project_name
    Purpose = "Parsed credit card statements"
  }
}

resource "aws_s3_bucket_public_access_block" "statements" {
  bucket = aws_s3_bucket.statements.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "statements" {
  bucket = aws_s3_bucket.statements.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "statements" {
  bucket = aws_s3_bucket.statements.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "statements" {
  bucket = aws_s3_bucket.statements.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}
```

**`terraform/iam.tf`** — policy document the Amplify service role will need:

```hcl
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
    sid    = "ListBucket"
    effect = "Allow"
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
```

**`terraform/terraform.tfvars.example`:**
```hcl
bucket_suffix = "huy-9674"  # any short unique string
```

### Apply

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars
terraform init
terraform plan
terraform apply
```

### Save outputs

After apply, save the outputs for the next steps:
```bash
terraform output statements_bucket_name
# → expense-tracker-statements-huy-9674

terraform output statements_policy_arn
# → arn:aws:iam::123456789012:policy/expense-tracker-statements-rw
```

Add the bucket name to `.env.local`:
```
STATEMENTS_BUCKET=expense-tracker-statements-huy-9674
```

### Local AWS credentials

For local development with the AWS SDK, configure credentials via `aws configure` or use the `AWS_PROFILE` env var. The Amplify Lambda runtime gets credentials automatically from the attached service role (set up in Step 11).

## Files affected

- `terraform/main.tf` — **create**
- `terraform/s3.tf` — **create**
- `terraform/iam.tf` — **create**
- `terraform/terraform.tfvars.example` — **create**
- `terraform/.gitignore` — **create** (`*.tfvars`, `.terraform/`, `*.tfstate*`)
- `.env.local` — add `STATEMENTS_BUCKET`

## Acceptance criteria

- `terraform plan` shows clean output with no errors
- `terraform apply` succeeds
- Running `aws s3 ls s3://<bucket-name>` returns empty list (bucket exists, empty)
- `aws s3api get-bucket-encryption --bucket <bucket-name>` confirms AES256
- `aws s3api get-public-access-block --bucket <bucket-name>` shows all blocks = true

## Notes & gotchas

- **Bucket names are globally unique.** The `bucket_suffix` variable handles this — use something like your initials or last 4 of card.
- **Versioning + 90-day expiration** is intentional: protects against accidental overwrites for 90 days, then cleans up to save storage cost.
- **`ap-southeast-1` (Singapore)** is the closest AWS region to HCMC for latency. Amplify should be deployed in the same region.
- **No CORS config needed** on the bucket — all S3 access goes through the Next.js API routes, never directly from the browser.
- **The IAM policy is created but not attached yet.** Step 11 attaches it to the Amplify service role during deployment.
- **Don't commit `terraform.tfvars` or `.tfstate`.** Both should be gitignored.
- **State file:** for personal use, local state is fine. If you ever want it remote, add an S3 backend block (use a *different* bucket for state).

## Next step

[Step 07 — Storage layer & statements CRUD](./07-storage-layer.md)
