# The admin console (M9) and the admin API behind it: a second container in the gateway's task (service.tf), reached
# through a CloudFront address of its own, so the console is its own origin, as its policies require. Administrators
# sign in with an Amazon Cognito user pool: no self sign-up, an authenticator app required, Cognito's own sign-in
# pages. While the environment sleeps the console answers that it is asleep; the pool and its users stay.

resource "random_password" "console_origin" {
  length  = 40
  special = false # proves a request came through the console's CloudFront; tells the load balancer where it goes
}

resource "aws_lb_target_group" "admin" {
  count                = var.awake ? 1 : 0
  name                 = "ucp-dev-admin"
  port                 = 8001
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 30
  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener_rule" "console_from_cloudfront" {
  count        = var.awake ? 1 : 0
  listener_arn = aws_lb_listener.edge[0].arn
  priority     = 2
  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.console_origin.result]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.admin[0].arn
  }
}

#trivy:ignore:AWS-0011 A web firewall is outside the base version (docs/tech-stack.md section 5); it comes with production
resource "aws_cloudfront_distribution" "console" {
  enabled             = true
  comment             = "ucp-dev console"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  wait_for_deployment = false

  origin {
    origin_id   = "admin"
    domain_name = var.awake ? aws_lb.edge[0].dns_name : "asleep.invalid"
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.console_origin.result
    }
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 30 # the slowest call is the install check, at most 10 s a page
    }
  }

  default_cache_behavior {
    target_origin_id         = "admin"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    compress                 = true

    dynamic "function_association" {
      for_each = var.awake ? [] : [aws_cloudfront_function.asleep.arn]
      content {
        event_type   = "viewer-request"
        function_arn = function_association.value
      }
    }
  }

  ordered_cache_behavior {
    path_pattern           = "/assets/*" # the console's and the preview's files, named by their content
    target_origin_id       = "admin"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
    compress               = true

    dynamic "function_association" {
      for_each = var.awake ? [] : [aws_cloudfront_function.asleep.arn]
      content {
        event_type   = "viewer-request"
        function_arn = function_association.value
      }
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

resource "aws_cognito_user_pool" "admins" {
  name                     = "ucp-dev-admins"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "ON"
  deletion_protection      = "INACTIVE" # dev; production protects its pool
  software_token_mfa_configuration {
    enabled = true # an authenticator app, set up at the first sign-in
  }
  admin_create_user_config {
    allow_admin_create_user_only = true # administrators are invited (infra/aws/console_admin.py), never sign up
  }
  password_policy {
    minimum_length                   = 14
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

resource "random_id" "admins" {
  byte_length = 4 # sign-in addresses are global; the account number stays out of the name
}

resource "aws_cognito_user_pool_domain" "admins" {
  domain                = "ucp-dev-admins-${random_id.admins.hex}"
  user_pool_id          = aws_cognito_user_pool.admins.id
  managed_login_version = 2 # Cognito's current sign-in pages, which set up the authenticator app
}

resource "aws_cognito_user_pool_client" "console" {
  name                                 = "ucp-dev-console"
  user_pool_id                         = aws_cognito_user_pool.admins.id
  generate_secret                      = false # a browser app: the code is exchanged with PKCE (web/console/src/signIn.ts)
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${aws_cloudfront_distribution.console.domain_name}/signed-in"]
  explicit_auth_flows                  = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  id_token_validity                    = 60 # the console's session ends a minute before its ID token expires
  access_token_validity                = 60
  refresh_token_validity               = 1
  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }
}

resource "aws_cognito_managed_login_branding" "console" {
  user_pool_id                = aws_cognito_user_pool.admins.id
  client_id                   = aws_cognito_user_pool_client.console.id
  use_cognito_provided_values = true
}

locals {
  # What the admin container is told (service.tf). The API's audience is the console's client: Cognito puts it in
  # the ID token the console sends.
  admin_environment = [
    { name = "UCP_ADMIN_ISSUER", value = "https://${aws_cognito_user_pool.admins.endpoint}" },
    { name = "UCP_ADMIN_AUDIENCE", value = aws_cognito_user_pool_client.console.id },
    { name = "UCP_ADMIN_ORIGINS", value = "https://${aws_cloudfront_distribution.console.domain_name}" },
    { name = "UCP_GATEWAY_ORIGIN", value = "https://${aws_cloudfront_distribution.edge.domain_name}" },
    { name = "UCP_VISITOR_ADDRESS_HEADER", value = "cloudfront-viewer-address" },
  ]
}
