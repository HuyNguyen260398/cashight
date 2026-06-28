terraform {
  backend "s3" {
    bucket       = "cashight-tfstate"
    key          = "cashight/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    kms_key_id   = "alias/cashight-tfstate"
    use_lockfile = true
  }
}
