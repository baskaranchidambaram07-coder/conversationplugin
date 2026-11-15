terraform {
  required_version = ">= 1.11" # write-only attributes keep generated secrets out of the state
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 6.0" }
    random = { source = "hashicorp/random", version = "~> 3.7" }
  }
  backend "s3" {} # bucket and key come from backend.hcl, written by infra/aws/stack.py from the bootstrap
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { project = "ucp", environment = var.environment, managed_by = "terraform" }
  }
}
