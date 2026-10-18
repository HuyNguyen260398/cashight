# Same bucket and key as the main root (../backend.tf), its own key. Applied
# from the workstation only: the Grafana tokens exist nowhere else.
terraform {
  backend "s3" {
    bucket       = "cashight-tfstate"
    key          = "cashight/grafana/terraform.tfstate"
    region       = "ap-southeast-1"
    encrypt      = true
    kms_key_id   = "alias/cashight-tfstate"
    use_lockfile = true
  }
}
