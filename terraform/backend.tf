terraform {
  backend "s3" {
    bucket       = "cashight-tfstate"
    key          = "cashight/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    use_lockfile = true
  }
}
