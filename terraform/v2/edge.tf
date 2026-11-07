# v2 certificates and the cashight-v2.nghuy.link SPA hosting. Mirrors
# terraform/edge.tf and terraform/acm.tf, with its own copies of the CloudFront
# helpers so a change to one stack can never break the other.
#
# api.cashight-v2.nghuy.link gets its certificate here; its DNS record points
# at the ALB, which exists only while the cluster does, so the record belongs
# to terraform/platform (Plan 4c).

data "aws_route53_zone" "nghuy_link" {
  name         = "nghuy.link."
  private_zone = false
}

# ── Certificates ─────────────────────────────────────────────────────────────

# CloudFront requires us-east-1.
resource "aws_acm_certificate" "frontend" {
  provider = aws.global

  domain_name       = "cashight-v2.nghuy.link"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
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

# Regional, for the ALB Ingress in Plan 4c.
resource "aws_acm_certificate" "api" {
  domain_name       = "api.cashight-v2.nghuy.link"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
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

# ── Frontend bucket (private, CloudFront OAC only; SEC-007) ──────────────────

resource "aws_s3_bucket" "frontend" {
  #checkov:skip=CKV_AWS_18:Static build assets, as v1's frontend bucket; CloudFront is the only reader and an access-log bucket adds cost without an audit need.
  #checkov:skip=CKV_AWS_144:The SPA is rebuilt and redeployed from Git; replication adds cost without a recovery requirement.
  #checkov:skip=CKV_AWS_145:Repository-standard AES256 encryption for public static assets, as in v1.
  #checkov:skip=CKV2_AWS_61:Deploys overwrite the build in place and versioning keeps the previous one; no expiry rule is wanted for live assets.
  #checkov:skip=CKV2_AWS_62:Static assets have no event-driven downstream workflow.
  bucket = "cashight-v2-frontend-${local.account_id}"
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  versioning_configuration {
    status = "Enabled"
  }
}

# ── CloudFront helpers (v2's own copies) ─────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "cashight-v2-frontend-oac"
  description                       = "OAC for the Cashight v2 SPA bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Same rewrite as v1's spa_router: extensionless paths serve <path>/index.html.
resource "aws_cloudfront_function" "spa_router" {
  name    = "cashight-v2-spa-router"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite extensionless paths to /index.html for SPA routing"
  publish = true

  code = <<-EOF
    function handler(event) {
      var request = event.request;
      var uri = request.uri;
      // Serve index.html for directory-style paths (SPA routes end with /)
      if (uri.endsWith('/')) {
        request.uri = uri + 'index.html';
      } else if (!uri.match(/\.[a-zA-Z0-9]+$/)) {
        // Extensionless path — redirect to trailing-slash form
        request.uri = uri + '/index.html';
      }
      return request;
    }
  EOF
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_response_headers_policy" "frontend" {
  name    = "cashight-v2-frontend-security-headers"
  comment = "Security headers for the Cashight v2 SPA"

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    xss_protection {
      mode_block = true
      protection = true
      override   = true
    }

    referrer_policy {
      referrer_policy = "strict-origin"
      override        = true
    }
  }
}

# ── Distribution ─────────────────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "frontend" {
  #checkov:skip=CKV_AWS_68:No WAF, as for v1 (see the comment below).
  #checkov:skip=CKV2_AWS_47:No WAF is attached, so there is no WebACL to configure.
  #checkov:skip=CKV_AWS_86:Matches v1; standard logs for a static single-user SPA add a log bucket and cost without an audit need.
  #checkov:skip=CKV_AWS_310:Single S3 origin, as v1; origin failover needs a second bucket for static assets that are rebuilt from Git.
  #checkov:skip=CKV_AWS_374:The single user travels; geo restriction would block legitimate access, as in v1.
  comment             = "Cashight SPA — v2 parallel stack (cashight-v2.nghuy.link)"
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"
  http_version        = "http2and3"
  aliases             = ["cashight-v2.nghuy.link"]

  # No WAF ACL, as for v1 (terraform/edge.tf): the origin is a static S3 bucket
  # behind OAC, so managed rule groups buy very little for $5/mo plus rules.

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.frontend.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "s3-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-frontend"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.frontend.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_router.arn
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

# ── Bucket policy: this distribution's OAC only, TLS only ────────────────────

data "aws_iam_policy_document" "frontend_oac" {
  statement {
    sid       = "AllowCloudFrontOAC"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.frontend.arn,
      "${aws_s3_bucket.frontend.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "frontend" {
  bucket     = aws_s3_bucket.frontend.id
  policy     = data.aws_iam_policy_document.frontend_oac.json
  depends_on = [aws_s3_bucket_public_access_block.frontend]
}

# ── DNS ──────────────────────────────────────────────────────────────────────

resource "aws_route53_record" "frontend" {
  for_each = toset(["A", "AAAA"])

  zone_id = data.aws_route53_zone.nghuy_link.zone_id
  name    = "cashight-v2.nghuy.link"
  type    = each.value

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}
