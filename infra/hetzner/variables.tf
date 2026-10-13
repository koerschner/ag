variable "location" {
  description = "Hetzner location; hil = Hillsboro, OR (US West)"
  type        = string
  default     = "hil"
}
variable "image" {
  type    = string
  default = "ubuntu-24.04"
}
variable "engine_enabled" {
  description = "false = destroy the engine machine but keep its data volume"
  type        = bool
  default     = true
}
variable "engine_type" {
  # New Hetzner accounts are capped at 8 dedicated vCPUs and can't request more yet ("account too new"),
  # so start on ccx33 and move to ccx53 (32 vCPU / 128 GB) once the limit is raised: ag-infra up -var engine_type=ccx53
  description = "ccx33 = 8 dedicated vCPU / 32 GB; ccx53 = 32 / 128; ccx63 = 48 / 192"
  type        = string
  default     = "ccx33"
}
variable "engine_volume_gb" {
  type    = number
  default = 200
}
variable "worker_count" {
  type    = number
  default = 0
}
variable "worker_type" {
  # Dedicated (ccx*) types count against the account's dedicated-vCPU limit, which the engine already fills,
  # so workers default to shared vCPUs: cpx62 = 16 AMD vCPU / 32 GB / 640 GB (EU, ~$0.25/h). cx53 (16 / 32 / 320,
  # ~$0.06/h) is cheaper but often sold out; ag-infra tries every EU location before giving up.
  description = "Hetzner server type for workers (ag-infra workers up --type)"
  type        = string
  default     = "cpx62"
}
variable "worker_location" {
  description = "Location for workers; \"\" = same as the engine. Shared types are far cheaper in the EU (nbg1, fsn1, hel1)."
  type        = string
  default     = "nbg1"
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
