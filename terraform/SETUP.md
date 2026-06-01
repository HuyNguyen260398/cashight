# Terraform Setup

This Terraform configuration uses an S3 backend for remote state. The backend bucket must exist before `terraform init` can run.

## 1. Create the Terraform State Bucket

Run this once from any directory with AWS credentials configured:

```bash
aws s3api create-bucket \
  --bucket cashight-tfstate-cashight-2026 \
  --region ap-southeast-1 \
  --create-bucket-configuration LocationConstraint=ap-southeast-1
```

Enable versioning so state history is retained:

```bash
aws s3api put-bucket-versioning \
  --bucket cashight-tfstate-cashight-2026 \
  --versioning-configuration Status=Enabled
```

Enable server-side encryption:

```bash
aws s3api put-bucket-encryption \
  --bucket cashight-tfstate-cashight-2026 \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
```

## 2. Initialize Terraform

After the state bucket exists:

```bash
cd terraform
terraform init
```

## 3. Review and Apply Infrastructure

```bash
terraform plan
terraform apply
```

The state bucket is only for Terraform state. The application statements bucket is managed separately by this Terraform configuration.
