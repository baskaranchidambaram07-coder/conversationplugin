# Alarms while awake (seen in the console; the deploying identity may not create notification topics), and what the
# scripts and the pipeline need to know. No output carries a secret.

resource "aws_cloudwatch_metric_alarm" "errors" {
  count               = var.awake ? 1 : 0
  alarm_name          = "ucp-dev-gateway-errors"
  alarm_description   = "The gateway answered with server errors"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.edge[0].arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
}

resource "aws_cloudwatch_metric_alarm" "unhealthy" {
  count               = var.awake ? 1 : 0
  alarm_name          = "ucp-dev-gateway-unhealthy"
  alarm_description   = "No healthy gateway behind the load balancer"
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = { LoadBalancer = aws_lb.edge[0].arn_suffix, TargetGroup = aws_lb_target_group.gateway[0].arn_suffix }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 5
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"
}

output "url" {
  description = "Where the loader, the chat and the API are served, awake or asleep."
  value       = "https://${aws_cloudfront_distribution.edge.domain_name}"
}

output "samples_url" {
  description = "The College's samples, hosted for trying the assistant (docs/college-sandbox-guide.md)."
  value       = "https://${aws_cloudfront_distribution.samples.domain_name}"
}

output "console_url" {
  description = "The admin console, where administrators sign in with the Cognito pool (infra/aws/console_admin.py)."
  value       = "https://${aws_cloudfront_distribution.console.domain_name}"
}

output "deploy_role_arn" {
  description = "For the pipeline's AWS_DEPLOY_ROLE_ARN secret (it contains the account number: never commit it)."
  value       = aws_iam_role.deploy.arn
}

output "awake" {
  value = var.awake
}
