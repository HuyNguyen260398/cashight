data "aws_caller_identity" "current" {}

# v1 values v2 needs (the shared Cognito user pool). Read only: nothing in
# this root writes a v1 resource.
data "terraform_remote_state" "v1" {
  backend = "s3"

  config = {
    bucket     = "cashight-tfstate"
    key        = "cashight/terraform.tfstate"
    region     = "ap-southeast-1"
    encrypt    = true
    kms_key_id = "alias/cashight-tfstate"
  }
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  v2_origin  = "https://cashight-v2.nghuy.link"
  tags = {
    Project     = "cashight"
    Environment = "v2"
    ManagedBy   = "Terraform"
  }
}
