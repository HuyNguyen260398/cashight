output "table_name" {
  description = "v2 DynamoDB table (TABLE_NAME)."
  value       = aws_dynamodb_table.cashight.name
}

output "table_arn" {
  description = "ARN of the v2 DynamoDB table."
  value       = aws_dynamodb_table.cashight.arn
}

output "statements_bucket_name" {
  description = "v2 statements bucket (STATEMENTS_BUCKET)."
  value       = aws_s3_bucket.statements.id
}

output "statements_bucket_arn" {
  description = "ARN of the v2 statements bucket."
  value       = aws_s3_bucket.statements.arn
}

output "uploads_bucket_name" {
  description = "v2 uploads bucket (UPLOAD_BUCKET)."
  value       = aws_s3_bucket.uploads.id
}

output "uploads_bucket_arn" {
  description = "ARN of the v2 uploads bucket."
  value       = aws_s3_bucket.uploads.arn
}

output "cost_exports_bucket_name" {
  description = "v2 Cost Explorer export bucket (EXPORT_BUCKET)."
  value       = aws_s3_bucket.cost_exports.id
}

output "cost_exports_bucket_arn" {
  description = "ARN of the v2 Cost Explorer export bucket."
  value       = aws_s3_bucket.cost_exports.arn
}

output "parse_queue_url" {
  description = "v2 statement parse queue (parser worker QUEUE_URL)."
  value       = aws_sqs_queue.parse.id
}

output "parse_queue_arn" {
  description = "ARN of the v2 statement parse queue."
  value       = aws_sqs_queue.parse.arn
}

output "invoice_parse_queue_url" {
  description = "v2 invoice parse queue (invoice parser worker QUEUE_URL)."
  value       = aws_sqs_queue.invoice_parse.id
}

output "invoice_parse_queue_arn" {
  description = "ARN of the v2 invoice parse queue."
  value       = aws_sqs_queue.invoice_parse.arn
}

output "cognito_user_pool_id" {
  description = "The shared (v1) Cognito user pool, passed through for 4c."
  value       = data.terraform_remote_state.v1.outputs.cognito_user_pool_id
}

output "frontend_bucket_name" {
  description = "v2 SPA bucket; the 4c deploy syncs the v2 build here."
  value       = aws_s3_bucket.frontend.id
}

output "frontend_bucket_arn" {
  description = "ARN of the v2 SPA bucket."
  value       = aws_s3_bucket.frontend.arn
}

output "cloudfront_distribution_id" {
  description = "v2 CloudFront distribution, for cache invalidation."
  value       = aws_cloudfront_distribution.frontend.id
}

output "cloudfront_distribution_arn" {
  description = "ARN of the v2 CloudFront distribution."
  value       = aws_cloudfront_distribution.frontend.arn
}

output "cloudfront_domain_name" {
  description = "v2 distribution domain (xxxx.cloudfront.net)."
  value       = aws_cloudfront_distribution.frontend.domain_name
}

output "frontend_certificate_arn" {
  description = "us-east-1 certificate for cashight-v2.nghuy.link."
  value       = aws_acm_certificate_validation.frontend.certificate_arn
}

output "api_certificate_arn" {
  description = "Regional certificate for api.cashight-v2.nghuy.link; the 4c Ingress attaches it to the ALB."
  value       = aws_acm_certificate_validation.api.certificate_arn
}
