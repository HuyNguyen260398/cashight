provider "grafana" {
  url             = var.grafana_url
  auth            = var.grafana_auth
  sm_url          = var.sm_url
  sm_access_token = var.sm_access_token
}

provider "aws" {
  region = "ap-southeast-1"
}
