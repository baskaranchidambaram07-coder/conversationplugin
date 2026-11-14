# Two zones. The gateway runs in public subnets with a public address so it can reach PF and the image registry
# without a NAT gateway (the user's choice for dev, about US$33 a month less); it accepts traffic only from the load
# balancer. The database sits in private subnets with no route out.

data "aws_availability_zones" "here" {
  state = "available"
}

locals {
  zones = slice(data.aws_availability_zones.here.names, 0, 2)
}

resource "aws_vpc" "main" {
  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "ucp-dev" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "ucp-dev" }
}

resource "aws_subnet" "public" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = local.zones[count.index]
  tags              = { Name = "ucp-dev-public-${count.index}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, 10 + count.index)
  availability_zone = local.zones[count.index]
  tags              = { Name = "ucp-dev-private-${count.index}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "ucp-dev-public" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# The private subnets keep the network's main route table, which has no route out.

# Found by name (the deploying user may list prefix lists, not read their entries, and needs only the ID).
data "aws_ec2_managed_prefix_lists" "cloudfront" {
  filter {
    name   = "prefix-list-name"
    values = ["com.amazonaws.global.cloudfront.origin-facing"]
  }
}

resource "aws_security_group" "edge" {
  name        = "ucp-dev-edge"
  description = "The load balancer: reachable from CloudFront only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "edge_from_cloudfront" {
  security_group_id = aws_security_group.edge.id
  description       = "CloudFront origin-facing addresses"
  prefix_list_id    = one(data.aws_ec2_managed_prefix_lists.cloudfront.ids)
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "edge_to_gateway" {
  security_group_id            = aws_security_group.edge.id
  description                  = "To the gateway (8000) and the admin API (8001)"
  referenced_security_group_id = aws_security_group.gateway.id
  ip_protocol                  = "tcp"
  from_port                    = 8000
  to_port                      = 8001
}

resource "aws_security_group" "gateway" {
  name        = "ucp-dev-gateway"
  description = "The gateway: reachable from the load balancer only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "gateway_from_edge" {
  security_group_id            = aws_security_group.gateway.id
  description                  = "From the load balancer"
  referenced_security_group_id = aws_security_group.edge.id
  ip_protocol                  = "tcp"
  from_port                    = 8000
  to_port                      = 8001
}

#trivy:ignore:AWS-0104 The gateway calls PF over the internet (no NAT, by the user's choice for dev); HTTPS only
resource "aws_vpc_security_group_egress_rule" "gateway_to_internet" {
  security_group_id = aws_security_group.gateway.id
  description       = "PF, the image registry, Secrets Manager and CloudWatch Logs, all over HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "gateway_to_database" {
  security_group_id            = aws_security_group.gateway.id
  description                  = "To PostgreSQL"
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_security_group" "database" {
  name        = "ucp-dev-database"
  description = "PostgreSQL: reachable from the gateway only"
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_gateway" {
  security_group_id            = aws_security_group.database.id
  description                  = "From the gateway"
  referenced_security_group_id = aws_security_group.gateway.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
