# Credentials come from the environment (aws configure export-credentials),
# as for the other roots in this repository.
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}

provider "kubernetes" {
  host                   = module.platform_cluster.cluster_endpoint
  cluster_ca_certificate = base64decode(module.platform_cluster.cluster_certificate_authority_data)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args = [
      "eks",
      "get-token",
      "--cluster-name",
      module.platform_cluster.cluster_name,
      "--region",
      var.aws_region,
    ]
  }
}
