# The gateway's settings that are secret, in Secrets Manager under ucp-dev/. The container service hands them to the
# gateway as environment variables, so the gateway itself never calls AWS (backend/tests/test_portable.py).
# Generated values are written once, write-only, and never stored in the state. The PF connection profiles come
# from .env through infra/aws/secret_store.py, so they never pass through Terraform at all.

ephemeral "random_password" "session_key" {
  length  = 43
  special = false
}

ephemeral "random_password" "smoke_secret" {
  length  = 43
  special = false
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "ucp-dev/database-url"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id                = aws_secretsmanager_secret.database_url.id
  secret_string_wo         = "postgresql+asyncpg://ucp:${ephemeral.random_password.database.result}@${aws_db_instance.main.address}:5432/ucp?ssl=require"
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret" "session_keys" {
  name                    = "ucp-dev/session-keys"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "session_keys" {
  secret_id                = aws_secretsmanager_secret.session_keys.id
  secret_string_wo         = "k1:${ephemeral.random_password.session_key.result}"
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret" "host_secrets" {
  name                    = "ucp-dev/host-secrets"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "host_secrets" {
  secret_id = aws_secretsmanager_secret.host_secrets.id
  secret_string_wo = jsonencode({
    smoke = "k1:${ephemeral.random_password.smoke_secret.result}"
    demo  = "k1:${random_password.demo.result}" # the hosted samples' sign-in (samples.tf)
  })
  # A customer's secret is added later with infra/aws/secret_store.py, not here. Raising this number writes the whole
  # value again and drops those: add them again afterwards, and hand the customers their new secrets.
  secret_string_wo_version = 2
}

resource "aws_secretsmanager_secret" "agent_profiles" {
  name                    = "ucp-dev/agent-profiles"
  recovery_window_in_days = 0
}

locals {
  secrets = {
    UCP_DATABASE_URL   = aws_secretsmanager_secret.database_url.arn
    UCP_SESSION_KEYS   = aws_secretsmanager_secret.session_keys.arn
    UCP_HOST_SECRETS   = aws_secretsmanager_secret.host_secrets.arn
    UCP_AGENT_PROFILES = aws_secretsmanager_secret.agent_profiles.arn
  }
}
