# One environment's settings. Each environment has a file infra/aws/environments/NAME.tfvars.json, which
# infra/aws/stack.py passes to Terraform: dev.tfvars.json is our development environment, example.tfvars.json the
# starting point for a customer's (infra/aws/SETUP.md). The defaults suit a customer.

variable "name" {
  description = <<-EOT
    The prefix of every resource's name, such as ucp-prod. The access policies are written for it
    (python infra/aws/stack.py policies), so it cannot change once built.
  EOT
  type        = string
  validation {
    # Load balancer and target group names stop at 32 characters; Cognito refuses these words in a sign-in address.
    condition     = can(regex("^[a-z][a-z0-9-]{2,18}[a-z0-9]$", var.name)) && !can(regex("aws|amazon|cognito", var.name))
    error_message = "4 to 20 lower-case letters, digits and hyphens, starting with a letter, without aws, amazon or cognito."
  }
}

variable "environment" {
  description = "The environment tag on every resource, such as prod or test. The access policies check it."
  type        = string
  default     = "prod"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "awake" {
  description = <<-EOT
    true: the gateway, its load balancer and the database run. false: only what keeps the address, the data and the
    secrets (about US$5 a month); CloudFront then answers that the service is away. infra/aws/stack.py up, wake and
    sleep set it; a bare terraform apply puts the environment to sleep.
  EOT
  type        = bool
  default     = false
}

variable "image" {
  description = <<-EOT
    The gateway's container image, pinned by digest. A bundle sets it in stack/release.auto.tfvars.json to the
    published image of its version; set it here to use a copy in your own registry instead. Unset (dev): the newest
    image the GitHub pipeline stored in this environment's own registry.
  EOT
  type        = string
  default     = null
}

variable "gateway_cpu" {
  description = <<-EOT
    The gateway's processor share (1024 is one vCPU). Half a vCPU queued a burst of 25 visitors arriving in the same
    second past M4's 150 ms budget for the gateway's share of a first word (infra/aws/latency.py).
  EOT
  type        = number
  default     = 1024
}

variable "gateway_memory" {
  type    = number
  default = 2048
}

variable "database_class" {
  type    = string
  default = "db.t4g.small"
}

variable "database_multi_az" {
  description = "A standby database in a second zone, which takes over if the first fails (about twice the cost)."
  type        = bool
  default     = true
}

variable "protect_data" {
  description = <<-EOT
    true: the database and the administrators' sign-in pool refuse to be deleted, so stack.py teardown stops at them
    until this is set to false and applied. Leave it true wherever the data matters.
  EOT
  type        = bool
  default     = true
}

variable "pf_profiles_from_script" {
  description = <<-EOT
    true (dev): the platform's own PF connection profiles are written by infra/aws/secret_store.py agent-profiles.
    false: the profiles start empty, and each organisation connects its PF agent in the admin console.
  EOT
  type        = bool
  default     = false
}

variable "widget_file" {
  description = <<-EOT
    A widget file in the image that each release publishes (dev: deploy/widgets.dev.json), undoing console edits to
    the widgets it names. Unset: widgets are made only in the admin console.
  EOT
  type        = string
  default     = null
}

variable "samples" {
  description = "Host the College's sample pages (dev only; they need the widget file's College widgets)."
  type        = bool
  default     = false
}

variable "github_subject_prefix" {
  description = <<-EOT
    Only where GitHub's pipeline deploys (dev). How GitHub names the repository in a run's identity, in GitHub's
    immutable form, which adds the owner's and the repository's public IDs, so a renamed or re-created repository
    cannot take over the deploy role. Read it with: gh api repos/OWNER/REPO/actions/oidc/customization/sub
    (sub_claim_prefix). Unset: no GitHub sign-in is made.
  EOT
  type        = string
  default     = null
}

variable "deploy_branches" {
  description = "Branches whose pushes may deploy to this environment (with github_subject_prefix)."
  type        = list(string)
  default     = []
}
