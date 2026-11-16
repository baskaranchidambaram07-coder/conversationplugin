# Dev only: the language sample sites (examples/<language>), for demonstrations. A private bucket, and one CloudFront
# address per site, so a widget allowed on one site is refused on the others. Kept apart from the stack: it neither
# sleeps nor wakes, and `python examples/sites.py --delete` removes all of it. examples/sites.py runs this, with the
# state beside the stack's in its state bucket.

terraform {
  required_version = ">= 1.11"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.7" }
  }
  backend "s3" {} # the stack's backend settings, with a key of its own (examples/sites.py)
}

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = { project = "ucp", environment = "dev", managed_by = "terraform", purpose = "demo-sites" }
  }
}

locals {
  sites = toset(["html", "php", "java", "dotnet", "ruby", "node", "go", "c", "cpp"]) # each under NAME/ in the bucket
}

resource "random_id" "bucket" {
  byte_length = 4 # bucket names are global; the account number stays out of the name
}

resource "aws_s3_bucket" "sites" {
  bucket        = "ucp-dev-sites-${random_id.bucket.hex}"
  force_destroy = true # it holds only the pages examples/sites.py uploads
}

#trivy:ignore:AWS-0132 AES-256 at rest; a key of our own needs KMS permissions the deploying user does not have
resource "aws_s3_bucket_server_side_encryption_configuration" "sites" {
  bucket = aws_s3_bucket.sites.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "sites" {
  bucket                  = aws_s3_bucket.sites.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "sites" {
  bucket = aws_s3_bucket.sites.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "TheseCloudFrontsOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.sites.arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = values(aws_cloudfront_distribution.sites)[*].arn } }
      },
      {
        Sid       = "TlsOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.sites.arn, "${aws_s3_bucket.sites.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.sites]
}

resource "aws_cloudfront_origin_access_control" "sites" {
  name                              = "ucp-dev-sites"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled" # a republished page shows at once
}

#trivy:ignore:AWS-0011 A web firewall is outside the base version (docs/tech-stack.md section 5); it comes with production
resource "aws_cloudfront_distribution" "sites" {
  for_each            = local.sites
  enabled             = true
  comment             = "ucp-dev-site-${each.key}"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  wait_for_deployment = false

  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.sites.bucket_regional_domain_name
    origin_path              = "/${each.key}"
    origin_access_control_id = aws_cloudfront_origin_access_control.sites.id
  }

  default_cache_behavior {
    target_origin_id       = "site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.disabled.id
    compress               = true
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

output "bucket" {
  value = aws_s3_bucket.sites.id
}

output "urls" {
  description = "Each site's address, the one to allow on its widget."
  value       = { for name, site in aws_cloudfront_distribution.sites : name => "https://${site.domain_name}" }
}
