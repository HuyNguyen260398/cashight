# v2-only persistent resources: data stores, image registry, certificates,
# the cashight-v2.nghuy.link SPA hosting and the v2 CI role. They outlive every
# test cluster. Separate from terraform/ because main and cashight-v2 share that
# root's state: an apply from main would destroy anything only cashight-v2 has.
# Applied from the workstation only, never from main; CI runs validate and test.
terraform {
  backend "s3" {
    bucket       = "cashight-tfstate"
    key          = "cashight/v2/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    kms_key_id   = "alias/cashight-tfstate"
    use_lockfile = true
  }
}
