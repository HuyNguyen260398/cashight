# Cashight's workload identities. Ephemeral with the cluster: the Pod Identity
# associations need it, so the roles live and die with this root.
#
# Each workload carries the union of its former Lambdas' grants
# (terraform/compute.tf in the v1 root, spec §4.2), pointed at the v2 data
# stores from terraform/v2. The v1 X-Ray grants are dropped: telemetry goes to
# the in-cluster OpenTelemetry Collector.

data "aws_caller_identity" "current" {}

data "terraform_remote_state" "v2" {
  backend = "s3"

  config = {
    bucket     = "cashight-tfstate"
    key        = "cashight/v2/terraform.tfstate"
    region     = "ap-southeast-1"
    encrypt    = true
    kms_key_id = "alias/cashight-tfstate"
  }
}

locals {
  api_hostname = "api.cashight-v2.nghuy.link"

  v2         = data.terraform_remote_state.v2.outputs
  account_id = data.aws_caller_identity.current.account_id

  # The SSM parameters are shared with v1 and read-only here
  # (terraform/compute.tf: aws_ssm_parameter.gemini_api_key / pdf_password).
  gemini_param_arn       = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter/cashight/prod/gemini-api-key"
  pdf_password_param_arn = "arn:aws:ssm:${var.aws_region}:${local.account_id}:parameter/cashight/prod/pdf-password"

  sqs_consume = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"]

  # Key = workload. service_account must match deploy/cashight/base/serviceaccounts.yaml.
  workloads = {
    api = {
      service_account = "cashight-api"
      # uploads, upload-status, statements, dashboard, summary, session-capabilities
      statements = [
        { sid = "S3PutUploads", actions = ["s3:PutObject"], resources = ["${local.v2.uploads_bucket_arn}/uploads/*"] },
        { sid = "S3ReadDeleteStatements", actions = ["s3:GetObject", "s3:DeleteObject"], resources = ["${local.v2.statements_bucket_arn}/users/*"] },
        { sid = "DynamoDBAccess", actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:DeleteItem"], resources = [local.v2.table_arn] },
        { sid = "GetGeminiKey", actions = ["ssm:GetParameter"], resources = [local.gemini_param_arn] },
      ]
    }
    aws-api = {
      service_account = "cashight-aws-api"
      # cost-explorer, aws-invoices, aws-invoice-summary
      statements = [
        {
          sid = "CostExplorerRead"
          actions = [
            "ce:GetCostAndUsage",
            "ce:GetCostAndUsageWithResources",
            "ce:GetCostForecast",
            "ce:GetUsageForecast",
            "ce:GetDimensionValues",
            "ce:GetTags",
            "ce:GetCostCategories",
            "ce:GetCostAndUsageComparisons",
            "ce:GetCostComparisonDrivers",
          ]
          resources = ["*"]
        },
        # Neither action supports resource-level permissions.
        { sid = "BillingRead", actions = ["billing:ListBillingViews", "aws-portal:ViewBilling"], resources = ["*"] },
        { sid = "BillingViewRead", actions = ["billing:GetBillingView"], resources = ["arn:aws:billing::${local.account_id}:billingview/*"] },
        { sid = "DynamoDBItems", actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:TransactWriteItems"], resources = [local.v2.table_arn] },
        { sid = "PrivateCsvExports", actions = ["s3:GetObject", "s3:PutObject"], resources = ["${local.v2.cost_exports_bucket_arn}/exports/*"] },
        { sid = "S3WriteInvoiceUploads", actions = ["s3:PutObject"], resources = ["${local.v2.uploads_bucket_arn}/uploads/aws-invoices/*"] },
        { sid = "S3ReadDeleteInvoices", actions = ["s3:GetObject", "s3:DeleteObject"], resources = ["${local.v2.statements_bucket_arn}/users/*/aws-invoices/*"] },
        { sid = "GetGeminiKey", actions = ["ssm:GetParameter"], resources = [local.gemini_param_arn] },
      ]
    }
    parser-worker = {
      service_account = "parser-worker"
      statements = [
        { sid = "S3ReadDeleteUploads", actions = ["s3:GetObject", "s3:DeleteObject"], resources = ["${local.v2.uploads_bucket_arn}/uploads/*"] },
        { sid = "S3ReadWriteStatements", actions = ["s3:PutObject", "s3:GetObject"], resources = ["${local.v2.statements_bucket_arn}/users/*"] },
        { sid = "DynamoDBAccess", actions = ["dynamodb:PutItem", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], resources = [local.v2.table_arn] },
        { sid = "GetPdfPassword", actions = ["ssm:GetParameter"], resources = [local.pdf_password_param_arn] },
        { sid = "SQSConsume", actions = local.sqs_consume, resources = [local.v2.parse_queue_arn] },
      ]
    }
    invoice-parser-worker = {
      service_account = "invoice-parser-worker"
      statements = [
        { sid = "S3ReadDeleteInvoiceUploads", actions = ["s3:GetObject", "s3:DeleteObject"], resources = ["${local.v2.uploads_bucket_arn}/uploads/aws-invoices/*"] },
        { sid = "S3ReadWriteInvoices", actions = ["s3:GetObject", "s3:PutObject"], resources = ["${local.v2.statements_bucket_arn}/users/*/aws-invoices/*"] },
        # Month-conflict detection needs a 404, not a 403, for a missing key
        # (see lambda_invoice_parser_worker_permissions in the v1 root).
        { sid = "S3ListStatementsBucket", actions = ["s3:ListBucket"], resources = [local.v2.statements_bucket_arn] },
        { sid = "DynamoDBInvoiceAccess", actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"], resources = [local.v2.table_arn] },
        { sid = "SQSConsumeInvoiceQueue", actions = local.sqs_consume, resources = [local.v2.invoice_parse_queue_arn] },
      ]
    }
  }

  # KEDA reads queue depth through these; nothing else.
  keda_scalers = {
    parse         = local.v2.parse_queue_arn
    invoice_parse = local.v2.invoice_parse_queue_arn
  }
}

# Same confused-deputy conditions as modules/platform_cluster/iam_pod_identity.tf.
data "aws_iam_policy_document" "workload_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [module.platform_cluster.cluster_arn]
    }
  }
}

resource "aws_iam_role" "workload" {
  for_each = local.workloads

  name               = "cashight-v2-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.workload_trust.json
  tags               = local.tags
}

data "aws_iam_policy_document" "workload" {
  for_each = local.workloads

  dynamic "statement" {
    for_each = each.value.statements
    content {
      sid       = statement.value.sid
      effect    = "Allow"
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "workload" {
  for_each = local.workloads

  name   = "cashight-v2-${each.key}"
  role   = aws_iam_role.workload[each.key].id
  policy = data.aws_iam_policy_document.workload[each.key].json
}

# Takes effect for Pods started after the namespace and ServiceAccount exist.
resource "aws_eks_pod_identity_association" "workload" {
  for_each = local.workloads

  cluster_name    = module.platform_cluster.cluster_name
  namespace       = "cashight"
  service_account = each.value.service_account
  role_arn        = aws_iam_role.workload[each.key].arn
  tags            = local.tags
}

data "aws_iam_policy_document" "keda_scaler_trust" {
  for_each = local.keda_scalers

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "AWS"
      identifiers = [module.platform_cluster.keda_operator_role_arn]
    }
  }
}

resource "aws_iam_role" "keda_scaler" {
  for_each = local.keda_scalers

  name               = "cashight-v2-keda-${replace(each.key, "_", "-")}"
  assume_role_policy = data.aws_iam_policy_document.keda_scaler_trust[each.key].json
  tags               = local.tags
}

data "aws_iam_policy_document" "keda_scaler" {
  for_each = local.keda_scalers

  statement {
    sid       = "ReadQueueDepth"
    effect    = "Allow"
    actions   = ["sqs:GetQueueAttributes"]
    resources = [each.value]
  }
}

resource "aws_iam_role_policy" "keda_scaler" {
  for_each = local.keda_scalers

  name   = "cashight-v2-keda-${replace(each.key, "_", "-")}"
  role   = aws_iam_role.keda_scaler[each.key].id
  policy = data.aws_iam_policy_document.keda_scaler[each.key].json
}

# api.cashight-v2.nghuy.link -> the ALB the load balancer controller creates for
# the `cashight` Ingress group. The ALB exists only after Argo CD has synced the
# Ingress, so bring-up sets api_alb_ready on a later apply. The record is
# destroyed with this root, so no stale name outlives the cluster.
data "aws_lb" "cashight" {
  count = var.api_alb_ready ? 1 : 0

  tags = {
    "elbv2.k8s.aws/cluster" = module.platform_cluster.cluster_name
    "ingress.k8s.aws/stack" = "cashight"
  }
}

data "aws_route53_zone" "nghuy_link" {
  count = var.api_alb_ready ? 1 : 0

  name         = "nghuy.link."
  private_zone = false
}

resource "aws_route53_record" "api" {
  for_each = var.api_alb_ready ? toset(["A", "AAAA"]) : toset([])

  zone_id = data.aws_route53_zone.nghuy_link[0].zone_id
  name    = local.api_hostname
  type    = each.key

  alias {
    name                   = data.aws_lb.cashight[0].dns_name
    zone_id                = data.aws_lb.cashight[0].zone_id
    evaluate_target_health = true
  }
}
