# Account-wide, not tag-filtered: a tag only becomes a usable budget filter
# after it is activated as a cost allocation tag, and AWS offers a tag for
# activation only once it has appeared on billed usage — a day after the spend
# this alarm exists to catch. Apply this resource before the cluster (see
# docs/platform.md, One-time setup).
locals {
  budget_notifications = {
    actual_50    = { type = "ACTUAL", threshold = 50 }
    actual_80    = { type = "ACTUAL", threshold = 80 }
    actual_100   = { type = "ACTUAL", threshold = 100 }
    forecast_100 = { type = "FORECASTED", threshold = 100 }
  }
}

resource "aws_budgets_budget" "account_monthly" {
  name         = "${var.resource_prefix}-account-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = local.budget_notifications

    content {
      comparison_operator        = "GREATER_THAN"
      notification_type          = notification.value.type
      threshold                  = notification.value.threshold
      threshold_type             = "PERCENTAGE"
      subscriber_email_addresses = var.budget_notification_emails
    }
  }

  tags = local.tags
}
