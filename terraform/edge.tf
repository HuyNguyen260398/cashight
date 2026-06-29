# terraform/edge.tf — Static SPA hosting: S3 (private), OAC, CloudFront, Route 53
#
# SEC-007: The S3 bucket has no website endpoint. All access is via CloudFront
# OAC only. TLS-only bucket policy + public access block enforced.

# ── Frontend S3 bucket (private, no website endpoint) ────────────────────────

resource "aws_s3_bucket" "frontend" {
  bucket = "cashight-frontend-${data.aws_caller_identity.current.account_id}"

  tags = {
    Project = var.project_name
    Purpose = "SPA static assets served via CloudFront OAC"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket = aws_s3_bucket.frontend.id

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

# ── CloudFront Origin Access Control ─────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "frontend" {
  name                              = "${var.project_name}-frontend-oac"
  description                       = "OAC for Cashight SPA frontend bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# ── CloudFront Function — SPA router ─────────────────────────────────────────
# Rewrites all requests that lack a file extension to /index.html so that
# client-side navigation (React Router / Next.js static export) works correctly.

resource "aws_cloudfront_function" "spa_router" {
  name    = "${var.project_name}-spa-router"
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

# ── Cache and response-headers policies ──────────────────────────────────────

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

resource "aws_cloudfront_response_headers_policy" "frontend" {
  name    = "${var.project_name}-frontend-security-headers"
  comment = "Security headers for Cashight SPA"

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

# ── CloudFront distribution ───────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "frontend" {
  # Before cutover: serves staging only (next.cashight.nghuy.link).
  # After cutover (cutover_dns_to_cloudfront=true): also serves production domain.
  comment             = var.cutover_dns_to_cloudfront ? "Cashight SPA — production (cashight.nghuy.link)" : "Cashight SPA — staging (next.cashight.nghuy.link)"
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200" # US, Europe, Asia (ap-southeast-1 PoP included)
  http_version        = "http2and3"

  aliases = var.cutover_dns_to_cloudfront ? [
    "cashight.nghuy.link",
    "next.cashight.nghuy.link",
    ] : [
    "next.cashight.nghuy.link",
  ]

  # Associate the existing CloudFront WAF ACL (shared with Amplify).
  # Retains Amplify protection until cutover; both distributions are guarded.
  web_acl_id = aws_wafv2_web_acl.cashight.arn

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

    # SPA router runs on every viewer request (before the cache check).
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_router.arn
    }
  }

  # Custom error pages: forward 403/404 from S3 to index.html so the SPA
  # can handle the route itself.
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

  tags = {
    Project = var.project_name
    Purpose = "Static SPA staging distribution"
  }
}

# ── S3 bucket policy — allow only CloudFront OAC (SEC-007) ───────────────────

data "aws_iam_policy_document" "frontend_oac" {
  statement {
    sid    = "AllowCloudFrontOAC"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.frontend.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudfront_distribution.frontend.arn]
    }
  }

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.frontend.arn,
      "${aws_s3_bucket.frontend.arn}/*",
    ]

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

# ── Route 53 — staging alias (next.cashight.nghuy.link → CloudFront) ─────────
# Always present. Validates the full stack before the production DNS switch.

resource "aws_route53_record" "frontend_temp" {
  zone_id = data.aws_route53_zone.nghuy_link.zone_id
  name    = "next.cashight.nghuy.link"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

# ── Route 53 — production alias (cashight.nghuy.link → CloudFront) ────────────
# Created when cutover_dns_to_cloudfront=true. At the same apply, the
# aws_amplify_domain_association is destroyed, releasing its DNS record so this
# record can take its place. Rollback: set cutover_dns_to_cloudfront=false and
# re-apply — the Amplify domain association is re-created and this record removed.

resource "aws_route53_record" "frontend_prod" {
  count = var.cutover_dns_to_cloudfront ? 1 : 0

  zone_id = data.aws_route53_zone.nghuy_link.zone_id
  name    = "cashight.nghuy.link"
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.frontend.domain_name
    zone_id                = aws_cloudfront_distribution.frontend.hosted_zone_id
    evaluate_target_health = false
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "frontend_bucket_name" {
  value       = aws_s3_bucket.frontend.id
  description = "S3 bucket for SPA static assets. Deploy with: aws s3 sync dist/ s3://<bucket>/"
}

output "cloudfront_distribution_id" {
  value       = aws_cloudfront_distribution.frontend.id
  description = "CloudFront distribution ID. Used for cache invalidation in CI."
}

output "cloudfront_domain_name" {
  value       = aws_cloudfront_distribution.frontend.domain_name
  description = "CloudFront origin domain (xxxx.cloudfront.net). Also in Cognito SPA callback URLs."
}

output "frontend_temp_url" {
  value       = "https://next.cashight.nghuy.link"
  description = "Staging URL for the new SPA distribution. Validate here before DNS cutover."
}

output "frontend_production_url" {
  value       = var.cutover_dns_to_cloudfront ? "https://cashight.nghuy.link" : "https://next.cashight.nghuy.link (cutover pending)"
  description = "Production URL. Reflects cashight.nghuy.link only after cutover_dns_to_cloudfront=true."
}

output "dns_cutover_active" {
  value       = var.cutover_dns_to_cloudfront
  description = "True when cashight.nghuy.link is pointing at CloudFront (post-cutover)."
}
