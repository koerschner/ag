variable "region" {
  description = "AWS region (us-east-1 = N. Virginia)"
  type        = string
  default     = "us-east-1"
  validation {
    condition     = startswith(var.region, "us-") && !startswith(var.region, "us-gov-")
    error_message = "Ag machines must be in the US: region must be a us-* region."
  }
}
variable "availability_zone" {
  description = "Single AZ for the machines and the engine's data volume (EBS volumes can't leave their AZ)"
  type        = string
  default     = "us-east-1a"
}
variable "owner" {
  description = "Owner tag on every resource (e.g. your work email); set in a *.auto.tfvars file"
  type        = string
  default     = ""
}
variable "engine_enabled" {
  description = "false = destroy the engine machine but keep its data volume"
  type        = bool
  default     = true
}
variable "engine_name" {
  description = "Engine hostname, Tailscale device name and Name tag"
  type        = string
  default     = "ag-engine"
}
variable "engine_type" {
  # Resize with `ag-infra up -var engine_type=…` (stop/start, a few minutes of downtime).
  description = "m7i.2xlarge = 8 vCPU / 32 GB; m7i.4xlarge = 16 / 64; m7i.8xlarge = 32 / 128"
  type        = string
  default     = "m7i.4xlarge"
}
variable "engine_root_gb" {
  description = "Root disk: repos, worktrees, docker, toolchains"
  type        = number
  default     = 400
}
variable "engine_volume_gb" {
  description = "Persistent data volume mounted at /data"
  type        = number
  default     = 250
}
variable "worker_count" {
  type    = number
  default = 0
}
variable "worker_type" {
  description = "EC2 type for workers (ag-infra workers up --type); c7a.4xlarge = 16 vCPU / 32 GB"
  type        = string
  default     = "c7a.4xlarge"
}
variable "worker_root_gb" {
  type    = number
  default = 200
}
variable "user" {
  description = "Linux login created on every machine (sessions run as it); set in a *.auto.tfvars file (infra/README.md)"
  type        = string
}
variable "ssh_public_key" {
  description = "ag-mac's ~/.ssh/id_ed25519.pub (break-glass; normal access is Tailscale SSH)"
  type        = string
}
variable "tailscale_auth_key" {
  description = "Ephemeral, pre-authorized, tagged Tailscale auth key (from op-work)"
  type        = string
  sensitive   = true
}
variable "ag_repo" {
  description = "SSH URL of your ag repo (cloned with ag_deploy_key), e.g. git@github.com:<owner>/ag.git"
  type        = string
}
variable "ag_deploy_key" {
  description = "Read-only GitHub deploy key for the private ag repo (from op-work)"
  type        = string
  sensitive   = true
}
variable "dotfiles_repo" {
  description = "Your personal dotfiles (https URL), stowed by bootstrap-linux; \"\" = the machine gets ag only"
  type        = string
  default     = ""
}
