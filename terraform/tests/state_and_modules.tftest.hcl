# tests/state_and_modules.tftest.hcl
# Smoke-tests for Task 10: state backend security and module skeleton.
# Run with: terraform test (from the terraform/ directory)

run "kms_key_exists" {
  command = plan

  assert {
    condition     = aws_kms_key.tfstate.enable_key_rotation == true
    error_message = "tfstate KMS key must have automatic rotation enabled"
  }

  assert {
    condition     = aws_kms_key.tfstate.deletion_window_in_days == 30
    error_message = "tfstate KMS key deletion window must be 30 days"
  }
}

run "tfstate_bucket_encrypted_with_kms" {
  command = plan

  assert {
    condition = alltrue([
      for rule in aws_s3_bucket_server_side_encryption_configuration.tfstate.rule :
      alltrue([
        for cfg in rule.apply_server_side_encryption_by_default :
        cfg.sse_algorithm == "aws:kms"
      ])
    ])
    error_message = "tfstate bucket must use aws:kms SSE algorithm"
  }

  assert {
    condition = alltrue([
      for rule in aws_s3_bucket_server_side_encryption_configuration.tfstate.rule :
      rule.bucket_key_enabled == true
    ])
    error_message = "tfstate bucket must have bucket-key enabled to reduce KMS costs"
  }
}

run "tfstate_bucket_public_access_blocked" {
  command = plan

  assert {
    condition     = aws_s3_bucket_public_access_block.tfstate.block_public_acls == true
    error_message = "tfstate bucket must block public ACLs"
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.tfstate.restrict_public_buckets == true
    error_message = "tfstate bucket must restrict public bucket access"
  }
}
