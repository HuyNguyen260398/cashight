# moved.tf — resource address migrations
#
# All existing resources stay at the root module during this task (Task 10).
# Module directories are skeletal (see terraform/modules/*/main.tf).
#
# moved blocks will be added in Tasks 11 and 12 as each module is populated
# and resources are relocated:
#
#   module.data        ← aws_s3_bucket.statements + sub-resources
#   module.auth        ← aws_cognito_user_pool.users, .domain, .client
#   module.observability ← aws_cloudwatch_metric_alarm.*, aws_sns_topic.*
#   module.cicd        ← aws_iam_role.github_deploy, aws_iam_role_policy.lambda_deploy
#   module.edge        ← aws_wafv2_web_acl.cashight
#
# Amplify resources removed in Phase 10 (chore: remove legacy amplify runtime).
