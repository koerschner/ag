# Ag on Hetzner Cloud: one brain (+ optional workers), rebuilt from zero by `ag-infra up`.
# Design: docs/ag.md. State lives outside the repo (~/.local/state/ag-infra), secrets come from op-work.
terraform {
  required_version = ">= 1.8"
  backend "local" {}
  required_providers {
    hcloud = { source = "hetznercloud/hcloud", version = "~> 1.52" }
  }
}

provider "hcloud" {} # HCLOUD_TOKEN from the environment (ag-infra injects it)

resource "hcloud_ssh_key" "ag_mac" {
  name       = "ag-mac"
  public_key = var.ssh_public_key
}

# Nothing is reachable from the internet except Tailscale's direct-connection port.
# SSH and everything else go over the tailnet (Hetzner's web console is the break-glass path).
resource "hcloud_firewall" "tailnet_only" {
  name = "ag-tailnet-only"
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "41641"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
  rule {
    direction  = "in"
    protocol   = "icmp"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

# Survives `ag-infra down`: Pi sessions, ~/inbox, ~/.local/state (tickler, logs), Herdr layout snapshots.
resource "hcloud_volume" "brain_data" {
  name     = "ag-brain-data"
  size     = var.brain_volume_gb
  location = var.location
  format   = "ext4"
  lifecycle { prevent_destroy = true }
}

resource "hcloud_server" "brain" {
  count        = var.brain_enabled ? 1 : 0
  name         = "ag-brain"
  server_type  = var.brain_type
  image        = var.image
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.ag_mac.id]
  firewall_ids = [hcloud_firewall.tailnet_only.id]
  labels       = { system = "ag", role = "brain" }
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    hostname       = "ag-brain"
    role           = "brain"
    user           = var.user
    ssh_public_key = var.ssh_public_key
    ts_auth_key    = var.tailscale_auth_key
    ts_tags        = "tag:ag-brain"
    dotfiles_repo  = var.dotfiles_repo
    volume_device  = "/dev/disk/by-id/scsi-0HC_Volume_${hcloud_volume.brain_data.id}"
  })
  public_net {
    ipv4_enabled = true # outbound IPv4 (GitHub, npm); inbound is blocked by the firewall
    ipv6_enabled = true
  }
  lifecycle { ignore_changes = [user_data, ssh_keys] }
}

resource "hcloud_volume_attachment" "brain_data" {
  count     = var.brain_enabled ? 1 : 0
  volume_id = hcloud_volume.brain_data.id
  server_id = hcloud_server.brain[0].id
  automount = false # cloud-init mounts it at /data
}

resource "hcloud_server" "worker" {
  count        = var.worker_count
  name         = "ag-worker-${count.index + 1}"
  server_type  = var.worker_type
  image        = var.image
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.ag_mac.id]
  firewall_ids = [hcloud_firewall.tailnet_only.id]
  labels       = { system = "ag", role = "worker" }
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    hostname       = "ag-worker-${count.index + 1}"
    role           = "worker"
    user           = var.user
    ssh_public_key = var.ssh_public_key
    ts_auth_key    = var.tailscale_auth_key
    ts_tags        = "tag:ag-worker"
    dotfiles_repo  = var.dotfiles_repo
    volume_device  = ""
  })
  lifecycle { ignore_changes = [user_data, ssh_keys] }
}
