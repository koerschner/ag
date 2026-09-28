variable "location" {
  description = "Hetzner location; hil = Hillsboro, OR (closest US region to Nathan)"
  type        = string
  default     = "hil"
}
variable "image" {
  type    = string
  default = "ubuntu-24.04"
}
variable "brain_enabled" {
  description = "false = destroy the brain machine but keep its data volume"
  type        = bool
  default     = true
}
variable "brain_type" {
  description = "ccx53 = 32 dedicated vCPU / 128 GB (start); ccx63 = 48 / 192"
  type        = string
  default     = "ccx53"
}
variable "brain_volume_gb" {
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
variable "dotfiles_repo" {
  type    = string
  default = "https://github.com/nathankoerschner/dotfiles.git"
}
