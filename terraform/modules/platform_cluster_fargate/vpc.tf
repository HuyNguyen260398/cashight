data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_region" "current" {}

locals {
  # EKS and the ALB both need two AZs; a third would only add subnets.
  availability_zones = slice(data.aws_availability_zones.available.names, 0, 2)

  public_subnets  = [for index in range(2) : cidrsubnet(var.vpc_cidr, 8, index)]
  private_subnets = [for index in range(2) : cidrsubnet(var.vpc_cidr, 8, index + 2)]
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 6.0"

  name = var.cluster_name
  cidr = var.vpc_cidr

  azs             = local.availability_zones
  public_subnets  = local.public_subnets
  private_subnets = local.private_subnets

  enable_dns_hostnames = true
  enable_dns_support   = true

  # Fargate pods live in private subnets and cannot have public IPs. One NAT
  # gateway in one AZ is cheaper than the ~7 interface endpoints the pods
  # would otherwise need (spec §3). Losing that AZ loses egress; accepted, as
  # v2 minimal is single-replica anyway.
  enable_nat_gateway     = true
  single_nat_gateway     = true
  one_nat_gateway_per_az = false

  public_subnet_tags = {
    "kubernetes.io/role/elb" = "1"
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = "1"
  }

  tags = var.tags
}

# Gateway endpoints are free and keep S3 and DynamoDB traffic off the NAT
# gateway. No interface endpoints: each costs more than the NAT share it saves.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.vpc.private_route_table_ids

  tags = merge(var.tags, { Name = "${var.cluster_name}-s3" })
}

resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id            = module.vpc.vpc_id
  service_name      = "com.amazonaws.${data.aws_region.current.region}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.vpc.private_route_table_ids

  tags = merge(var.tags, { Name = "${var.cluster_name}-dynamodb" })
}
