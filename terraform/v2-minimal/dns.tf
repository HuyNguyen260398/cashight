# api.cashight-v2.nghuy.link -> the ALB the load balancer controller creates
# for the `cashight` Ingress group. The ALB appears only after the first
# deploy, so the record appears on the first apply after it; no flag needed.
# The record is destroyed with this root.

data "aws_lbs" "cashight" {
  tags = {
    "elbv2.k8s.aws/cluster" = local.cluster_name
    "ingress.k8s.aws/stack" = "cashight"
  }
}

locals {
  api_alb_ready = length(data.aws_lbs.cashight.arns) == 1
}

data "aws_lb" "cashight" {
  count = local.api_alb_ready ? 1 : 0

  arn = one(data.aws_lbs.cashight.arns)
}

data "aws_route53_zone" "nghuy_link" {
  count = local.api_alb_ready ? 1 : 0

  name         = "nghuy.link."
  private_zone = false
}

resource "aws_route53_record" "api" {
  for_each = local.api_alb_ready ? toset(["A", "AAAA"]) : toset([])

  zone_id = data.aws_route53_zone.nghuy_link[0].zone_id
  name    = local.api_hostname
  type    = each.key

  alias {
    name                   = data.aws_lb.cashight[0].dns_name
    zone_id                = data.aws_lb.cashight[0].zone_id
    evaluate_target_health = true
  }
}
