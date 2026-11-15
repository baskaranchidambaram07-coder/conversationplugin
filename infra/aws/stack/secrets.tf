# The gateway's settings that are secret, in Secrets Manager under the environment's name (ucp-dev/ in dev). The
# container service hands them to the gateway as environment variables, so the gateway itself never calls AWS
# (backend/tests/test_portable.py). Generated values are written once, write-only, and never stored in the state. The
# platform's own PF connection profiles, if any, come from .env through infra/aws/secret_store.py, so they never pass
# through Terraform at all; a customer's organisations connect PF in the admin console instead.

ephemeral "random_password" "session_key" {
  length  = 43
  special = false
}

ephemeral "random_password" "smoke_secret" {
  length  = 43
  special = false
}

# Seals the secrets administrators set through the admin API (ucp.vault): 43 base64url characters are 32 bytes.
ephemeral "random_password" "secrets_key" {
  length  = 43
  special = false
}

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${var.name}/database-url"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id                = aws_secretsmanager_secret.database_url.id
  secret_string_wo         = "postgresql+asyncpg://ucp:${ephemeral.random_password.database.result}@${aws_db_instance.main.address}:5432/ucp?ssl=require"
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret" "session_keys" {
  name                    = "${var.name}/session-keys"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "session_keys" {
  secret_id                = aws_secretsmanager_secret.session_keys.id
  secret_string_wo         = "k1:${ephemeral.random_password.session_key.result}"
  secret_string_wo_version = 1
}

resource "aws_secretsmanager_secret" "host_secrets" {
  name                    = "${var.name}/host-secrets"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "host_secrets" {
  secret_id = aws_secretsmanager_secret.host_secrets.id
  secret_string_wo = jsonencode(merge(
    { smoke = "k1:${ephemeral.random_password.smoke_secret.result}" },
    { for demo in random_password.demo : "demo" => "k1:${demo.result}" }, # the hosted samples' sign-in (samples.tf)
  ))
  # A customer's secret is added later with infra/aws/secret_store.py, not here. Raising this number writes the whole
  # value again and drops those: add them again afterwards, and hand the customers their new secrets.
  secret_string_wo_version = 2
}

resource "aws_secretsmanager_secret" "secrets_key" {
  name                    = "${var.name}/secrets-key"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "secrets_key" {
  secret_id                = aws_secretsmanager_secret.secrets_key.id
  secret_string_wo         = "k1:${ephemeral.random_password.secrets_key.result}"
  secret_string_wo_version = 1 # never written again: a new key would leave the sealed secrets unreadable
}

resource "aws_secretsmanager_secret" "agent_profiles" {
  name                    = "${var.name}/agent-profiles"
  recovery_window_in_days = 0
}

# Starts empty where secret_store.py does not fill it, so the gateway can start: organisations connect PF in the
# console.
resource "aws_secretsmanager_secret_version" "agent_profiles" {
  count                    = var.pf_profiles_from_script ? 0 : 1
  secret_id                = aws_secretsmanager_secret.agent_profiles.id
  secret_string_wo         = "{}"
  secret_string_wo_version = 1
}

locals {
  secrets = {
    UCP_DATABASE_URL   = aws_secretsmanager_secret.database_url.arn
    UCP_SESSION_KEYS   = aws_secretsmanager_secret.session_keys.arn
    UCP_HOST_SECRETS   = aws_secretsmanager_secret.host_secrets.arn
    UCP_AGENT_PROFILES = aws_secretsmanager_secret.agent_profiles.arn
    UCP_SECRETS_KEY    = aws_secretsmanager_secret.secrets_key.arn
  }
}
