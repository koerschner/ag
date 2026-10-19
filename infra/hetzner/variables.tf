# Ag machines must run in the US (near the owner): Hetzner's only US locations are ash and hil.
variable "location" {
  description = "Hetzner location: hil = Hillsboro, OR or ash = Ashburn, VA (US only)"
  type        = string
  default     = "hil"
  validation {
    condition     = contains(["ash", "hil"], var.location)
    error_message = "Ag machines must be in the US: location must be ash or hil."
  }
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
  # Shared vCPUs, so workers don't count against the dedicated-vCPU limit the engine fills. In the US the
  # largest shared type is cpx51 (16 AMD vCPU / 32 GB / 360 GB, ~$0.45/h); cpx62/cx* exist only in the EU.
  description = "Hetzner server type for workers (ag-infra workers up --type)"
  type        = string
  default     = "cpx51"
}
variable "worker_location" {
  description = "Location for workers: ash or hil (US only); \"\" = same as the engine"
  type        = string
  default     = ""
  validation {
    condition     = contains(["", "ash", "hil"], var.worker_location)
    error_message = "Ag machines must be in the US: worker_location must be ash, hil or \"\"."
  }
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
