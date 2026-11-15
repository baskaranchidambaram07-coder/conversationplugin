# The gateway: one container on Fargate, its image registry, its logs and its two roles, under the project's
# permissions boundary. The admin API and console run beside it in the same task (console.tf), from the same image. While the environment sleeps the service is removed; the cluster, the task definition and
# the images stay, so waking picks up the newest image the pipeline has stored.

data "aws_caller_identity" "here" {}

locals {
  # The project's permissions boundary, made by an administrator (infra/aws/iam). Named from the account the plan
  # runs in, as the deploying user may not search policies; the account number never appears in the code.
  boundary = "arn:aws:iam::${data.aws_caller_identity.here.account_id}:policy/${var.name}-boundary"
  # A bundle's published image, or (dev) the newest one the pipeline stored in the registry below.
  image = coalesce(var.image, "${aws_ecr_repository.gateway.repository_url}:latest")
}

#trivy:ignore:AWS-0031 Immutable except "latest" (IMMUTABLE_WITH_EXCLUSION), a setting the check does not yet recognise
resource "aws_ecr_repository" "gateway" {
  name                 = "${var.name}-gateway"
  image_tag_mutability = "IMMUTABLE_WITH_EXCLUSION" # a release's commit tag never changes; only "latest" moves
  force_delete         = true
  image_tag_mutability_exclusion_filter {
    filter      = "latest"
    filter_type = "WILDCARD"
  }
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "gateway" {
  repository = aws_ecr_repository.gateway.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the newest 15 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 15 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/${var.name}/gateway"
  retention_in_days = 14
}

resource "aws_ecs_cluster" "main" {
  name = "${var.name}-cluster"
}

locals {
  ecs_trust = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

# What the container service does to start the gateway: pull its image, write its logs, hand it its secrets.
resource "aws_iam_role" "execution" {
  name                 = "${var.name}-task-execution"
  assume_role_policy   = local.ecs_trust
  permissions_boundary = local.boundary
}

resource "aws_iam_role_policy" "execution" {
  name = "start-the-gateway"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = aws_ecr_repository.gateway.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.gateway.arn}:*"
      },
      { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = values(local.secrets) },
    ]
  })
}

# The gateway itself needs no AWS permission: everything reaches it as settings.
resource "aws_iam_role" "task" {
  name                 = "${var.name}-task"
  assume_role_policy   = local.ecs_trust
  permissions_boundary = local.boundary
}

resource "aws_ecs_task_definition" "gateway" {
  family                   = "${var.name}-gateway"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.gateway_cpu
  memory                   = var.gateway_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name                   = "gateway"
    image                  = local.image
    essential              = true
    readonlyRootFilesystem = true
    stopTimeout            = 120 # the gateway gives open answers up to 110 s to finish when a task is replaced
    portMappings           = [{ containerPort = 8000, protocol = "tcp" }]
    environment = concat([
      { name = "UCP_PUBLIC_ORIGIN", value = "https://${aws_cloudfront_distribution.edge.domain_name}" },
      { name = "UCP_VISITOR_ADDRESS_HEADER", value = "cloudfront-viewer-address" },
      ], [
      # The hosted samples' site, which the widget file names as an allowed site (backend/deploy/widgets.dev.json).
      for samples in aws_cloudfront_distribution.samples : { name = "UCP_SAMPLES_ORIGIN", value = "https://${samples.domain_name}" }
    ])
    secrets = [for name, arn in local.secrets : { name = name, valueFrom = arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.gateway.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "gateway"
      }
    }
    }, {
    # Not essential: if it stops, visitors keep their chat; its load balancer check then has the task replaced.
    name                   = "admin"
    image                  = local.image
    essential              = false
    readonlyRootFilesystem = true
    command = ["uvicorn", "ucp.admin.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8001",
    "--no-server-header", "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*"]
    portMappings = [{ containerPort = 8001, protocol = "tcp" }]
    environment  = local.admin_environment
    secrets      = [for name, arn in local.secrets : { name = name, valueFrom = arn }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.gateway.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "admin"
      }
    }
  }])
}

resource "aws_ecs_service" "gateway" {
  count                              = var.awake ? 1 : 0
  name                               = "${var.name}-gateway"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.gateway.family # the newest revision: the pipeline's
  desired_count                      = 1
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.gateway.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.gateway[0].arn
    container_name   = "gateway"
    container_port   = 8000
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.admin[0].arn
    container_name   = "admin"
    container_port   = 8001
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true # a release that never becomes healthy is replaced by the one before
  }
  lifecycle {
    ignore_changes = [task_definition] # the deploy pipeline moves the service to each new release
  }
  # On a first build the secrets' values, and the database behind one of them, come before the first task starts.
  depends_on = [
    aws_lb_listener_rule.from_cloudfront, aws_lb_listener_rule.console_from_cloudfront,
    aws_secretsmanager_secret_version.database_url, aws_secretsmanager_secret_version.session_keys,
    aws_secretsmanager_secret_version.host_secrets, aws_secretsmanager_secret_version.secrets_key,
    aws_secretsmanager_secret_version.agent_profiles,
  ]
}
