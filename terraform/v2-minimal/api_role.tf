# The merged API's IRSA role (spec §4.2).

locals {
  api_service_account_subject = "system:serviceaccount:cashight:cashight-api"

  # Copied from terraform/platform/workloads.tf (local.workloads.api and
  # local.workloads["aws-api"]): their union, minus both GetGeminiKey grants,
  # as AI summaries are off in v2 minimal (spec §5.4). Keep in sync.
  api_statements = [
    # api: uploads, upload-status, statements, dashboard, session-capabilities
    { sid = "S3PutUploads", actions = ["s3:PutObject"], resources = ["${local.v2.uploads_bucket_arn}/uploads/*"] },
    { sid = "S3ReadDeleteStatements", actions = ["s3:GetObject", "s3:DeleteObject"], resources = ["${local.v2.statements_bucket_arn}/users/*"] },
    { sid = "DynamoDBAccess", actions = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:DeleteItem"], resources = [local.v2.table_arn] },
    # aws-api: cost-explorer, aws-invoices
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
  ]
}

data "aws_iam_policy_document" "api_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [module.cluster.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.cluster.oidc_issuer}:sub"
      values   = [local.api_service_account_subject]
    }

    condition {
      test     = "StringEquals"
      variable = "${module.cluster.oidc_issuer}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "cashight-v2-min-api"
  assume_role_policy = data.aws_iam_policy_document.api_assume_role.json
}

data "aws_iam_policy_document" "api" {
  #checkov:skip=CKV_AWS_356:Cost Explorer and billing list actions support no resource-level permissions.
  dynamic "statement" {
    for_each = local.api_statements
    content {
      sid       = statement.value.sid
      effect    = "Allow"
      actions   = statement.value.actions
      resources = statement.value.resources
    }
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "cashight-v2-min-api"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}
