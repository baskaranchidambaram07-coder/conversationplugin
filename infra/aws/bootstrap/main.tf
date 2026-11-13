# The bucket that holds the dev environment's Terraform state (encrypted, versioned, private, TLS only). Run once;
# its own state is local and git-ignored, as it records nothing but this bucket. infra/aws/dev.py writes the
# resulting backend settings to infra/aws/dev/backend.hcl, also git-ignored.

terraform {
  required_version = ">= 1.11"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.7" }
  }
}

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = { project = "ucp", environment = "dev", managed_by = "terraform" }
  }
}

resource "random_id" "suffix" {
  byte_length = 4 # bucket names are global; the account number stays out of the name
}

resource "aws_s3_bucket" "state" {
  bucket = "ucp-dev-tfstate-${random_id.suffix.hex}"
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

#trivy:ignore:AWS-0132 AES-256 at rest; a key of our own needs KMS permissions the deploying user does not have
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "TlsOnly"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.state.arn, "${aws_s3_bucket.state.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.state]
}

output "bucket" {
  value = aws_s3_bucket.state.bucket
}
