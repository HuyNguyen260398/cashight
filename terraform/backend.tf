terraform {
  # Partial backend configuration. Real values live in backend.hcl (gitignored).
  # Initialize with: terraform init -backend-config=backend.hcl
  backend "s3" {}
}
