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

variable "github_repository" {
  description = "The repository whose pipeline may deploy, as owner/name."
  type        = string
  default     = "baskaranchidambaram07-coder/conversationplugin"
}

variable "deploy_branches" {
  description = "Branches whose pushes may deploy to this environment."
  type        = list(string)
  default     = ["develop", "module/m14-cloud-deployment"]
}
