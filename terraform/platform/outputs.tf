output "gitops_repo_url" {
  description = "AWS CodeConnections Git HTTP endpoint for the GitOps repository."
  value       = local.gitops_repo_url
}

output "vpc_id" {
  description = "ID of the platform VPC."
  value       = module.platform_cluster.vpc_id
}

output "vpc_arn" {
  description = "ARN of the platform VPC."
  value       = module.platform_cluster.vpc_arn
}

output "private_subnet_ids" {
  description = "IDs of the three private platform subnets."
  value       = module.platform_cluster.private_subnet_ids
}

output "public_subnet_ids" {
  description = "IDs of the three public platform subnets."
  value       = module.platform_cluster.public_subnet_ids
}

output "cluster_name" {
  description = "Name of the Amazon EKS platform cluster."
  value       = module.platform_cluster.cluster_name
}

output "cluster_arn" {
  description = "ARN of the Amazon EKS platform cluster."
  value       = module.platform_cluster.cluster_arn
}

output "cluster_endpoint" {
  description = "API endpoint of the Amazon EKS platform cluster."
  value       = module.platform_cluster.cluster_endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64-encoded certificate authority data for the Amazon EKS platform cluster."
  value       = module.platform_cluster.cluster_certificate_authority_data
}

output "oidc_provider_arn" {
  description = "ARN of the IAM OIDC provider used for EKS IRSA roles."
  value       = module.platform_cluster.oidc_provider_arn
}

output "oidc_provider_url" {
  description = "URL of the IAM OIDC provider used for EKS IRSA roles."
  value       = module.platform_cluster.oidc_provider_url
}

output "node_group_name" {
  description = "Name of the general-purpose EKS managed node group."
  value       = module.platform_cluster.node_group_name
}

output "node_security_group_id" {
  description = "Security group attached to general node-group instances and their Pods."
  value       = module.platform_cluster.node_security_group_id
}

output "keda_operator_role_arn" {
  description = "ARN of the IAM role the KEDA operator runs as. Scaler roles trust this ARN."
  value       = module.platform_cluster.keda_operator_role_arn
}

output "otel_collector_role_arn" {
  description = "ARN of the IAM role the OpenTelemetry Collector runs as."
  value       = module.platform_cluster.otel_collector_role_arn
}

output "argocd_enabled" {
  description = "Whether the managed Argo CD capability and GitOps bootstrap are deployed."
  value       = var.enable_argocd
}

output "grafana_cloud_parameter_path" {
  description = "SSM path holding the Grafana Cloud OTLP parameters the collector reads."
  value       = local.grafana_cloud_parameter_path
}

output "keda_scaler_role_arns" {
  description = "KEDA scaler roles by queue (parse, invoice_parse). deploy/cashight TriggerAuthentications name these."
  value       = { for k, r in aws_iam_role.keda_scaler : k => r.arn }
}

output "workload_role_arns" {
  description = "Pod Identity roles of the four Cashight workloads, by workload."
  value       = { for k, r in aws_iam_role.workload : k => r.arn }
}

output "api_hostname" {
  description = "Public hostname of the v2 API. Its record exists only while api_alb_ready is true."
  value       = local.api_hostname
}
