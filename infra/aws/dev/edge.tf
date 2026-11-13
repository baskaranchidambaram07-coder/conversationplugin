# The way in. CloudFront gives HTTPS on an address AWS provides and stays while the environment sleeps, so the
# address in a customer's script tag never changes. Behind it, a load balancer only CloudFront can reach, which
# forwards only requests carrying CloudFront's secret header. While asleep the load balancer is removed and
# CloudFront points at a name that never resolves, so visitors get an error, never a stranger's server.

resource "random_password" "origin" {
  length  = 40
  special = false # kept in the state: it only proves a request came through CloudFront, and the bucket is private
}

#trivy:ignore:AWS-0053 CloudFront must reach it (VPC origins need a role the deploying user may not create); only CloudFront's addresses carrying its secret header get in
resource "aws_lb" "edge" {
  count                      = var.awake ? 1 : 0
  name                       = "ucp-dev-edge"
  load_balancer_type         = "application"
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.edge.id]
  idle_timeout               = 120 # beyond the gateway's 15 s heartbeat on a streamed answer
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "gateway" {
  count                = var.awake ? 1 : 0
  name                 = "ucp-dev-gateway"
  port                 = 8000
  protocol             = "HTTP"
  target_type          = "ip"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 120
  health_check {
    path                = "/healthz"
    matcher             = "200"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

#trivy:ignore:AWS-0054 CloudFront to the load balancer only; visitors use HTTPS to CloudFront. HTTPS here needs our own domain and certificate (production)
resource "aws_lb_listener" "edge" {
  count             = var.awake ? 1 : 0
  load_balancer_arn = aws_lb.edge[0].arn
  port              = 80
  protocol          = "HTTP" # CloudFront to the load balancer; visitors reach CloudFront over HTTPS only
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not here."
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "from_cloudfront" {
  count        = var.awake ? 1 : 0
  listener_arn = aws_lb_listener.edge[0].arn
  priority     = 1
  condition {
    http_header {
      http_header_name = "X-Origin-Verify"
      values           = [random_password.origin.result]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway[0].arn
  }
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewerAndCloudFrontHeaders-2022-06" # includes CloudFront-Viewer-Address, for per-visitor limits
}

#trivy:ignore:AWS-0011 A web firewall is outside the base version (docs/tech-stack.md section 5); it comes with production
resource "aws_cloudfront_distribution" "edge" {
  enabled             = true
  comment             = "ucp-dev"
  price_class         = "PriceClass_100"
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  wait_for_deployment = false # infra/aws/dev.py waits only where it matters

  origin {
    origin_id   = "gateway"
    domain_name = var.awake ? aws_lb.edge[0].dns_name : "asleep.invalid"
    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin.result
    }
    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_read_timeout      = 60 # the gateway sends a heartbeat at least every 15 s while an answer streams
      origin_keepalive_timeout = 5
    }
  }

  default_cache_behavior {
    target_origin_id         = "gateway"
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
    compress                 = true
  }

  ordered_cache_behavior {
    path_pattern           = "/assets/*" # the chat's files, named by their content, so cached for long
    target_origin_id       = "gateway"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
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
