# Credentials come from the environment (aws configure export-credentials),
# as for the other roots in this repository.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}
