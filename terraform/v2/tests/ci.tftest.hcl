# Run with: terraform test (from terraform/v2/). Mock providers: no AWS
# credentials or v1 state needed.

mock_provider "aws" {
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

mock_provider "aws" {
  alias = "global"
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
}

override_data {
  target = data.aws_caller_identity.current
  values = { account_id = "111122223333" }
}

override_data {
  target = data.terraform_remote_state.v1
  values = {
    outputs = {
      cognito_user_pool_id    = "ap-southeast-1_stub"
      cognito_smoke_client_id = "smokeclient"
    }
  }
}

override_data {
  target = data.aws_route53_zone.nghuy_link
  values = { zone_id = "Z000STUB", name = "nghuy.link" }
}

override_resource {
  target          = aws_cloudfront_distribution.frontend
  override_during = plan
  values = {
    arn            = "arn:aws:cloudfront::111122223333:distribution/STUB"
    domain_name    = "dstub.cloudfront.net"
    hosted_zone_id = "Z2FDTNDATAQYW2"
  }
}

override_resource {
  target          = aws_acm_certificate.frontend
  override_during = plan
  values = {
    arn = "arn:aws:acm:us-east-1:111122223333:certificate/frontend-stub"
    domain_validation_options = [{
      domain_name           = "cashight-v2.nghuy.link"
      resource_record_name  = "_f.cashight-v2.nghuy.link."
      resource_record_type  = "CNAME"
      resource_record_value = "_f.acm-validations.aws."
    }]
  }
}

override_resource {
  target          = aws_acm_certificate.api
  override_during = plan
  values = {
    arn = "arn:aws:acm:ap-southeast-1:111122223333:certificate/api-stub"
    domain_validation_options = [{
      domain_name           = "api.cashight-v2.nghuy.link"
      resource_record_name  = "_a.api.cashight-v2.nghuy.link."
      resource_record_type  = "CNAME"
      resource_record_value = "_a.acm-validations.aws."
    }]
  }
}

override_data {
  target = data.aws_iam_openid_connect_provider.github
  values = { arn = "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com" }
}

run "ecr_is_immutable_and_scanned" {
  command = plan

  assert {
    condition = (
      aws_ecr_repository.backend.name == "cashight-backend" &&
      aws_ecr_repository.backend.image_tag_mutability == "IMMUTABLE" &&
      one(aws_ecr_repository.backend.image_scanning_configuration).scan_on_push == true
    )
    error_message = "ECR repository settings"
  }

  assert {
    condition     = length(jsondecode(aws_ecr_lifecycle_policy.backend.policy).rules) == 2
    error_message = "untagged-expiry and keep-last-20 rules"
  }
}

# Policy documents are mocked, so the trust subject is asserted on the local
# the trust policy's only :sub condition reads.
run "ci_role_trusts_only_cashight_v2" {
  command = plan

  assert {
    condition     = aws_iam_role.github_ci.name == "cashight-v2-github-ci"
    error_message = "role name"
  }

  assert {
    condition     = local.github_ci_subjects == ["repo:HuyNguyen260398/cashight:ref:refs/heads/cashight-v2"]
    error_message = "trust is limited to the cashight-v2 branch"
  }
}

# v2 minimal (terraform/v2-minimal): CI describes its cluster and deploys its
# two worker Lambdas. Asserted on the policy document's arguments, which the
# mock leaves intact.
run "ci_role_deploys_v2_minimal" {
  command = plan

  assert {
    condition = alltrue([
      for sid in ["EksDescribeMinimal", "DeployMinimalWorkers"] :
      contains([for s in data.aws_iam_policy_document.github_ci.statement : s.sid], sid)
    ])
    error_message = "EksDescribeMinimal and DeployMinimalWorkers statements"
  }

  assert {
    condition = one([
      for s in data.aws_iam_policy_document.github_ci.statement : s.resources if s.sid == "EksDescribeMinimal"
      ]) == toset(["arn:aws:eks:ap-southeast-1:111122223333:cluster/cashight-v2-min"]) && one([
      for s in data.aws_iam_policy_document.github_ci.statement : s.actions if s.sid == "EksDescribeMinimal"
    ]) == toset(["eks:DescribeCluster"])
    error_message = "describe only, on cashight-v2-min only"
  }

  assert {
    condition = one([
      for s in data.aws_iam_policy_document.github_ci.statement : s.resources if s.sid == "DeployMinimalWorkers"
      ]) == toset([
      "arn:aws:lambda:ap-southeast-1:111122223333:function:cashight-v2-parser-worker",
      "arn:aws:lambda:ap-southeast-1:111122223333:function:cashight-v2-parser-worker:*",
      "arn:aws:lambda:ap-southeast-1:111122223333:function:cashight-v2-invoice-parser-worker",
      "arn:aws:lambda:ap-southeast-1:111122223333:function:cashight-v2-invoice-parser-worker:*",
    ])
    error_message = "worker deploys are limited to the two v2-minimal functions"
  }

  assert {
    condition = one([
      for s in data.aws_iam_policy_document.github_ci.statement : s.actions if s.sid == "DeployMinimalWorkers"
      ]) == toset([
      "lambda:UpdateFunctionCode", "lambda:PublishVersion", "lambda:GetFunction",
      "lambda:GetFunctionConfiguration", "lambda:GetAlias", "lambda:UpdateAlias",
    ])
    error_message = "worker deploy actions"
  }
}
