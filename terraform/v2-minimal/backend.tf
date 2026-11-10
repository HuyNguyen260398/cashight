# Always-on v2 minimal (docs/v2-minimal.md): a Fargate-only EKS cluster plus
# Lambda parse workers, reading the persistent v2 stores from terraform/v2.
# Same bucket as the other roots, its own key. Applied from the workstation
# only (scripts/v2-minimal/apply.sh); CI runs validate and test, never plan or
# apply.
terraform {
  backend "s3" {
    bucket       = "cashight-tfstate"
    key          = "cashight/v2-minimal/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    kms_key_id   = "alias/cashight-tfstate"
    use_lockfile = true
  }
}
