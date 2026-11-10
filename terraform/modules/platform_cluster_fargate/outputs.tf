output "cluster_name" {
  description = "Name of the EKS cluster."
  value       = module.eks.cluster_name
}

output "cluster_arn" {
  description = "ARN of the EKS cluster."
  value       = module.eks.cluster_arn
}

output "cluster_endpoint" {
  description = "API endpoint of the EKS cluster."
  value       = module.eks.cluster_endpoint
}

output "cluster_certificate_authority_data" {
  description = "Base64-encoded certificate authority data of the EKS cluster."
  value       = module.eks.cluster_certificate_authority_data
}

output "oidc_provider_arn" {
  description = "ARN of the IAM OIDC provider used for IRSA."
  value       = module.eks.oidc_provider_arn
}

output "oidc_issuer" {
  description = "OIDC issuer host and path, without https://, as IRSA trust conditions use it."
  value       = module.eks.oidc_provider
}

output "vpc_id" {
  description = "ID of the cluster VPC."
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnets, where the Fargate pods run."
  value       = module.vpc.private_subnets
}

output "public_subnet_ids" {
  description = "Public subnets, where the ALB and the NAT gateway live."
  value       = module.vpc.public_subnets
}

output "load_balancer_controller_role_arn" {
  description = "IRSA role of the AWS Load Balancer Controller."
  value       = aws_iam_role.load_balancer_controller.arn
}

# The outputs below exist so the root's terraform tests can assert the
# cost anti-goals (spec §2) without reaching into nested modules.

output "nat_gateway_ids" {
  description = "NAT gateways created for the VPC; exactly one by design."
  value       = module.vpc.natgw_ids
}

output "gateway_endpoint_types" {
  description = "Endpoint type of each VPC endpoint the module creates."
  value       = [aws_vpc_endpoint.s3.vpc_endpoint_type, aws_vpc_endpoint.dynamodb.vpc_endpoint_type]
}

output "managed_node_group_count" {
  description = "Number of EKS managed node groups; zero, as compute is Fargate only."
  value       = length(module.eks.eks_managed_node_groups)
}

output "upgrade_support_type" {
  description = "The cluster's upgrade-policy support type; STANDARD so it never bills extended support."
  value       = local.upgrade_policy.support_type
}
