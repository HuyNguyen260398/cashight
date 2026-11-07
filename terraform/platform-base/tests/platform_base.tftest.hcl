mock_provider "aws" {}

override_data {
  target = data.aws_ssoadmin_instances.current
  values = {
    identity_store_ids = ["d-1234567890"]
    arns               = ["arn:aws:sso:::instance/ssoins-1"]
  }
}

override_data {
  target = data.aws_caller_identity.current
  values = {
    account_id = "111122223333"
  }
}

variables {
  budget_notification_emails = ["ops@example.com"]
  argocd_admin_user_ids      = ["u-1"]
}

run "budget_is_account_wide_with_four_alerts" {
  command = plan

  assert {
    condition     = aws_budgets_budget.account_monthly.name == "cashight-account-monthly"
    error_message = "budget name"
  }

  assert {
    condition     = aws_budgets_budget.account_monthly.limit_amount == "50"
    error_message = "default monthly_budget_usd is 50"
  }

  assert {
    condition     = length(aws_budgets_budget.account_monthly.notification) == 4
    error_message = "actual 50/80/100 and forecast 100"
  }
}

run "connection_and_group_names" {
  command = plan

  assert {
    condition     = aws_codeconnections_connection.github.name == "cashight-github" && aws_codeconnections_connection.github.provider_type == "GitHub"
    error_message = "connection"
  }

  assert {
    condition     = aws_identitystore_group.argocd_admins.display_name == "cashight-argocd-admins"
    error_message = "group"
  }
}

run "rejects_empty_budget_emails" {
  command = plan

  variables {
    budget_notification_emails = []
  }

  expect_failures = [var.budget_notification_emails]
}
