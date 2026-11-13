# PostgreSQL 17, encrypted, private, with seven days of point-in-time backups. One zone in dev; production in London
# runs across two. While the environment sleeps, infra/aws/dev.py stops it (AWS starts a stopped database again
# after seven days, so sleep stops it again).

resource "aws_db_subnet_group" "main" {
  name       = "ucp-dev-database"
  subnet_ids = aws_subnet.private[*].id
}

# Generated afresh each run but written only when the database is created (the _wo_version stays 1), and never
# stored in the state: the same value goes to the database and to the gateway's connection secret in that run.
ephemeral "random_password" "database" {
  length  = 40
  special = false
}

resource "aws_db_instance" "main" {
  identifier                 = "ucp-dev-database"
  engine                     = "postgres"
  engine_version             = "17"
  instance_class             = "db.t4g.micro"
  allocated_storage          = 20
  storage_type               = "gp3"
  storage_encrypted          = true
  db_name                    = "ucp"
  username                   = "ucp"
  password_wo                = ephemeral.random_password.database.result
  password_wo_version        = 1
  db_subnet_group_name       = aws_db_subnet_group.main.name
  vpc_security_group_ids     = [aws_security_group.database.id]
  publicly_accessible        = false
  multi_az                   = false
  backup_retention_period    = 7
  auto_minor_version_upgrade = true
  apply_immediately          = true
  copy_tags_to_snapshot      = true
  deletion_protection        = false # dev holds test data only; the runbook rebuilds it from code
  skip_final_snapshot        = true
}
