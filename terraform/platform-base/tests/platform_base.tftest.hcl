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

run "v2_minimal_budget_off_by_default" {
  command = plan

  assert {
    condition     = length(aws_budgets_budget.v2_minimal) == 0 && length(aws_ce_cost_allocation_tag.environment) == 0
    error_message = "the tag budget waits for enable_v2_minimal_budget"
  }
}

run "v2_minimal_budget" {
  command = plan

  variables {
    enable_v2_minimal_budget = true
  }

  assert {
    condition = (
      aws_budgets_budget.v2_minimal[0].limit_amount == "200" &&
      aws_budgets_budget.v2_minimal[0].time_unit == "MONTHLY" &&
      length(aws_budgets_budget.v2_minimal[0].notification) == 2
    )
    error_message = "$200 a month with two alerts"
  }

  assert {
    condition = alltrue([
      for n in aws_budgets_budget.v2_minimal[0].notification :
      n.notification_type == "ACTUAL" && contains([80, 100], n.threshold) && n.subscriber_email_addresses == toset(["ops@example.com"])
    ])
    error_message = "ACTUAL 80 % and 100 % to the budget emails"
  }

  assert {
    condition = anytrue([
      for f in aws_budgets_budget.v2_minimal[0].cost_filter :
      f.name == "TagKeyValue" && f.values == tolist(["user:Environment$v2-minimal"])
    ])
    error_message = "filtered on the Environment=v2-minimal tag"
  }

  assert {
    condition     = aws_ce_cost_allocation_tag.environment[0].tag_key == "Environment" && aws_ce_cost_allocation_tag.environment[0].status == "Active"
    error_message = "Environment is an active cost allocation tag"
  }
}
