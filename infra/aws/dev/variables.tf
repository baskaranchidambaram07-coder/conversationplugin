variable "awake" {
  description = <<-EOT
    true: the gateway, its load balancer and the database run (about US$0.09 an hour). false: only what keeps the
    address, the data and the secrets (about US$5 a month); CloudFront then answers that the service is away.
    infra/aws/dev.py wake and sleep set it; a bare terraform apply puts the environment to sleep.
  EOT
  type        = bool
  default     = false
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "github_subject_prefix" {
  description = <<-EOT
    How GitHub names this repository in a run's identity. The repository uses GitHub's immutable form, which adds the
    owner's and the repository's public IDs, so a renamed or re-created repository cannot take over the deploy role.
    Read it with: gh api repos/OWNER/REPO/actions/oidc/customization/sub (sub_claim_prefix).
  EOT
  type        = string
  default     = "repo:baskaranchidambaram07-coder@266725199/conversationplugin@1455037781"
}

variable "deploy_branches" {
  description = "Branches whose pushes may deploy to this environment."
  type        = list(string)
  default     = ["develop", "module/m14-cloud-deployment"]
}
