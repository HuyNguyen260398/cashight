terraform {
  required_version = ">= 1.10" # backend use_lockfile (native S3 state locking) requires >= 1.10
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Optional: configure remote state
  # backend "s3" { ... }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "ap-southeast-1"
}

variable "project_name" {
  type    = string
  default = "expense-tracker"
}

variable "bucket_suffix" {
  type        = string
  description = "Random suffix to ensure global uniqueness"
  default     = "cashight-2026"
}
