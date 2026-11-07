# Persistent account-level platform resources: the budget, the Argo CD admin
# group and the CodeConnections connection. They outlive every test cluster.
# Same bucket as the main root (../backend.tf), its own key. Applied from the
# workstation only; CI runs validate and test, never plan or apply.
terraform {
  backend "s3" {
    bucket       = "cashight-tfstate"
    key          = "cashight/platform-base/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    kms_key_id   = "alias/cashight-tfstate"
    use_lockfile = true
  }
}
