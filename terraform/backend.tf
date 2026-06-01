terraform {
  backend "s3" {
    bucket       = "cashight-tfstate-cashight-2026"
    key          = "cashight/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
