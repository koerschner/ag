variable "location" {
  description = "Hetzner location; hil = Hillsboro, OR (closest US region to Nathan)"
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
  type    = string
  default = "ccx33"
}
variable "user" {
  type    = string
  default = "nathan"
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
  type    = string
  default = "git@github.com:nathankoerschner/ag.git"
}
variable "ag_deploy_key" {
  description = "Read-only GitHub deploy key for the private ag repo (from op-work)"
  type        = string
  sensitive   = true
}
variable "dotfiles_repo" {
  type    = string
  default = "https://github.com/nathankoerschner/dotfiles.git"
}
