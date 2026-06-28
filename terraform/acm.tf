# terraform/acm.tf — ACM TLS certificates
#
# Two certs are needed:
#   1. CloudFront cert (us-east-1, MUST be global for CF) — cashight.nghuy.link + next.cashight.nghuy.link
#   2. API Gateway Regional cert (ap-southeast-1)         — api.cashight.nghuy.link

data "aws_route53_zone" "nghuy_link" {
  name         = "nghuy.link."
  private_zone = false
}

# ── CloudFront certificate (must live in us-east-1) ──────────────────────────

resource "aws_acm_certificate" "frontend" {
  provider = aws.global

  domain_name               = "cashight.nghuy.link"
  subject_alternative_names = ["next.cashight.nghuy.link"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Project = var.project_name
    Purpose = "CloudFront TLS"
  }
}

resource "aws_route53_record" "frontend_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.frontend.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.nghuy_link.zone_id
}

resource "aws_acm_certificate_validation" "frontend" {
  provider = aws.global

  certificate_arn         = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [for record in aws_route53_record.frontend_cert_validation : record.fqdn]
}

# ── API Gateway certificate (ap-southeast-1 regional) ────────────────────────

resource "aws_acm_certificate" "api" {
  domain_name       = "api.cashight.nghuy.link"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Project = var.project_name
    Purpose = "API Gateway custom domain TLS"
  }
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.nghuy_link.zone_id
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.api_cert_validation : record.fqdn]
}
