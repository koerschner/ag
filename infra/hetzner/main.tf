# Ag on Hetzner Cloud: one engine (+ optional workers), rebuilt from zero by `ag-infra up`.
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
resource "hcloud_volume" "engine_data" {
  name     = "ag-engine-data"
  size     = var.engine_volume_gb
  location = var.location
  format   = "ext4"
  lifecycle { prevent_destroy = true }
}

resource "hcloud_server" "engine" {
  count        = var.engine_enabled ? 1 : 0
  name         = "ag-engine"
  server_type  = var.engine_type
  image        = var.image
  location     = var.location
  ssh_keys     = [hcloud_ssh_key.ag_mac.id]
  firewall_ids = [hcloud_firewall.tailnet_only.id]
  labels       = { system = "ag", role = "engine" }
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", {
    hostname          = "ag-engine"
    role              = "engine"
    user              = var.user
    ssh_public_key    = var.ssh_public_key
    ts_auth_key       = var.tailscale_auth_key
    ts_tags           = "tag:ag-engine"
    dotfiles_repo     = var.dotfiles_repo
    ag_repo           = var.ag_repo
    ag_deploy_key_b64 = base64encode("${trimspace(var.ag_deploy_key)}\n") # OpenSSH needs the trailing newline $(...) strips
    volume_device     = "/dev/disk/by-id/scsi-0HC_Volume_${hcloud_volume.engine_data.id}"
  })
  public_net {
    ipv4_enabled = true # outbound IPv4 (GitHub, npm); inbound is blocked by the firewall
    ipv6_enabled = true
  }
  lifecycle { ignore_changes = [user_data, ssh_keys] }
}

resource "hcloud_volume_attachment" "engine_data" {
  count     = var.engine_enabled ? 1 : 0
  volume_id = hcloud_volume.engine_data.id
  server_id = hcloud_server.engine[0].id
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
    hostname          = "ag-worker-${count.index + 1}"
    role              = "worker"
    user              = var.user
    ssh_public_key    = var.ssh_public_key
    ts_auth_key       = var.tailscale_auth_key
    ts_tags           = "tag:ag-worker"
    dotfiles_repo     = var.dotfiles_repo
    ag_repo           = var.ag_repo
    ag_deploy_key_b64 = base64encode("${trimspace(var.ag_deploy_key)}\n") # OpenSSH needs the trailing newline $(...) strips
    volume_device     = ""
  })
  lifecycle { ignore_changes = [user_data, ssh_keys] }
}

# 2026-09-29: "brain" renamed to "engine" (same resources, new names).
moved {
  from = hcloud_volume.brain_data
  to   = hcloud_volume.engine_data
}
moved {
  from = hcloud_server.brain
  to   = hcloud_server.engine
}
moved {
  from = hcloud_volume_attachment.brain_data
  to   = hcloud_volume_attachment.engine_data
}
