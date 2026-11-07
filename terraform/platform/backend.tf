# Ephemeral test cluster: created for a test day and destroyed with
# scripts/platform/destroy-platform.sh (docs/platform.md). Reads the persistent
# resources from the platform-base root. Same bucket as the main root
# (../backend.tf), its own key. Applied from the workstation only; CI runs
# validate and test, never plan or apply.
terraform {
  backend "s3" {
    bucket       = "cashight-tfstate"
    key          = "cashight/platform/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    kms_key_id   = "alias/cashight-tfstate"
    use_lockfile = true
  }
}
