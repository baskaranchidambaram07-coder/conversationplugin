# The College's samples, hosted so it can try the assistant before changing anything (M15,
# docs/college-sandbox-guide.md). A private bucket behind a CloudFront address of its own, so the pages sit on another
# site than the gateway's, as a customer's pages do. Terraform fills the pages in from the repository, so a changed
# sample goes out with the next apply (infra/aws/dev.py wake or sleep). They stay while the environment sleeps; the
# chat simply does not appear then. The portal's sign-in is functions/demo-token.js, for the demo widget only.

locals {
  # The widgets the pages name, found by the host secret each one's sign-in uses (backend/deploy/widgets.dev.json).
  widgets = jsondecode(file("${path.module}/../../../backend/deploy/widgets.dev.json")).widgets
  signing = { for id, widget in local.widgets : widget.identity.secret => id if can(widget.identity.secret) }
  samples = { # the published name, and its source in examples/college: our hosted portal over the College's
    "public.html"    = "public.html"
    "portal.html"    = "hosted/portal.html"
    "portal.js"      = "hosted/portal.js"
    "assistant.html" = "hosted/assistant.html"
    "assistant.js"   = "hosted/assistant.js"
    "assistant.css"  = "assistant.css"
  }
  types = { html = "text/html; charset=utf-8", js = "text/javascript; charset=utf-8", css = "text/css; charset=utf-8" }
}

resource "random_id" "samples" {
  byte_length = 4 # bucket names are global; the account number stays out of the name
}

resource "aws_s3_bucket" "samples" {
  bucket        = "ucp-dev-samples-${random_id.samples.hex}"
  force_destroy = true # it holds only the pages Terraform writes
}

#trivy:ignore:AWS-0132 AES-256 at rest; a key of our own needs KMS permissions the deploying user does not have
resource "aws_s3_bucket_server_side_encryption_configuration" "samples" {
  bucket = aws_s3_bucket.samples.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "samples" {
  bucket                  = aws_s3_bucket.samples.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "samples" {
  bucket = aws_s3_bucket.samples.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ThisCloudFrontOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.samples.arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.samples.arn } }
      },
      {
        Sid       = "TlsOnly"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.samples.arn, "${aws_s3_bucket.samples.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })
  depends_on = [aws_s3_bucket_public_access_block.samples]
}

resource "aws_s3_object" "samples" {
  for_each      = local.samples
  bucket        = aws_s3_bucket.samples.id
  key           = each.key
  content_type  = local.types[regex("[a-z]+$", each.key)]
  cache_control = "no-store"
  content = replace(replace(replace(
    file("${path.module}/../../../examples/college/${each.value}"),
    "{{GATEWAY}}", "https://${aws_cloudfront_distribution.edge.domain_name}"),
    "{{WIDGET}}", local.signing["college"]),
  "{{DEMO_WIDGET}}", local.signing["demo"])
}

resource "random_password" "demo" {
  length  = 43
  special = false # kept in the state: it is in the sign-in function's code anyway, and signs for the demo widget only
}

resource "aws_cloudfront_function" "demo_token" {
  name    = "ucp-dev-demo-token"
  runtime = "cloudfront-js-2.0"
  comment = "Signs the hosted samples' demo sign-in"
  publish = true
  code    = templatefile("${path.module}/functions/demo-token.js", { secret = random_password.demo.result })
}

resource "aws_cloudfront_origin_access_control" "samples" {
  name                              = "ucp-dev-samples"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

#trivy:ignore:AWS-0011 A web firewall is outside the base version (docs/tech-stack.md section 5); it comes with production
resource "aws_cloudfront_distribution" "samples" {
  enabled             = true
  comment             = "ucp-dev-samples"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  default_root_object = "public.html"
  wait_for_deployment = false

  origin {
    origin_id                = "samples"
    domain_name              = aws_s3_bucket.samples.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.samples.id
  }

  default_cache_behavior {
    target_origin_id       = "samples"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.disabled.id # a changed page shows at once
    compress               = true
  }

  ordered_cache_behavior {
    path_pattern           = "/demo-token"
    target_origin_id       = "samples"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.disabled.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.demo_token.arn
    }
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
