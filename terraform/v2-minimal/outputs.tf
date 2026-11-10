output "cluster_name" {
  description = "Name of the v2 minimal EKS cluster."
  value       = module.cluster.cluster_name
}

output "api_role_arn" {
  description = "IRSA role of cashight-api; deploy/cashight/overlays/v2-minimal/serviceaccount.yaml must carry it."
  value       = aws_iam_role.api.arn
}

output "api_certificate_arn" {
  description = "ACM certificate of api.cashight-v2.nghuy.link (from terraform/v2); the overlay's Ingress must carry it."
  value       = local.v2.api_certificate_arn
}

output "log_group_name" {
  description = "CloudWatch log group of the cashight namespace's container logs."
  value       = aws_cloudwatch_log_group.app.name
}
