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
