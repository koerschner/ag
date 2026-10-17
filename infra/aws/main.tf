# Ag on AWS (EC2): one engine (+ optional workers), rebuilt from zero by `ag-infra up`.
# Design: docs/ag.md. State lives outside the repo (~/.local/state/ag-infra/aws), secrets come from op-work,
# AWS credentials from the environment (AWS_PROFILE; ag-infra reads AG_AWS_PROFILE from ~/ag-personal/env).
terraform {
  required_version = ">= 1.8"
  backend "local" {}
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.80" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = merge({ Project = "ag", ManagedBy = "opentofu" }, var.owner == "" ? {} : { Owner = var.owner })
  }
}

data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# The account's default VPC: shared AWS accounts hit the VPC limit, and its default subnets already have public
# IPs and an internet gateway for outbound traffic. Inbound is closed by the security group below.
data "aws_vpc" "default" {
  default = true
}
data "aws_subnet" "public" {
  vpc_id            = data.aws_vpc.default.id
  availability_zone = var.availability_zone
  default_for_az    = true
}

# Nothing is reachable from the internet except Tailscale's direct-connection port (and ping).
# SSH and everything else go over the tailnet; break-glass is SSM Session Manager (no inbound port).
resource "aws_security_group" "tailnet_only" {
  name        = "ag-tailnet-only"
  description = "Ag machines: Tailscale direct connections only"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    description = "Tailscale"
    from_port   = 41641
    to_port     = 41641
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    description = "ping"
    from_port   = -1
    to_port     = -1
    protocol    = "icmp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "ag-tailnet-only" }
}

# Break-glass shell without SSH: `aws ssm start-session --target <instance id>`.
resource "aws_iam_role" "ag" {
  name = "ag-machine"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}
resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ag.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
resource "aws_iam_instance_profile" "ag" {
  name = "ag-machine"
  role = aws_iam_role.ag.name
}

resource "aws_key_pair" "ag_mac" {
  key_name   = "ag-mac"
  public_key = var.ssh_public_key
}

# Survives `ag-infra down`: Pi sessions, ~/inbox, ~/.local/state (ag-tickler, logs), ag-mux layout snapshots.
resource "aws_ebs_volume" "engine_data" {
  availability_zone = var.availability_zone
  size              = var.engine_volume_gb
  type              = "gp3"
  encrypted         = true
  tags              = { Name = "ag-engine-data" }
  lifecycle { prevent_destroy = true }
}

locals {
  common = {
    user              = var.user
    ssh_public_key    = var.ssh_public_key
    ts_auth_key       = var.tailscale_auth_key
    dotfiles_repo     = var.dotfiles_repo
    ag_repo           = var.ag_repo
    ag_deploy_key_b64 = base64encode("${trimspace(var.ag_deploy_key)}\n") # OpenSSH needs the trailing newline $(...) strips
  }
}

resource "aws_instance" "engine" {
  count                  = var.engine_enabled ? 1 : 0
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.engine_type
  subnet_id              = data.aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.tailnet_only.id]
  key_name               = aws_key_pair.ag_mac.key_name
  iam_instance_profile   = aws_iam_instance_profile.ag.name
  metadata_options {
    http_tokens = "required"
  }
  root_block_device {
    volume_size = var.engine_root_gb
    volume_type = "gp3"
    encrypted   = true
    tags        = { Name = "ag-engine-root" }
  }
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", merge(local.common, {
    hostname      = var.engine_name
    role          = "engine"
    ts_tags       = "tag:ag-engine"
    volume_device = "/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${replace(aws_ebs_volume.engine_data.id, "-", "")}"
  }))
  tags = { Name = var.engine_name, Role = "engine" }
  lifecycle { ignore_changes = [ami, user_data, key_name] }
}

resource "aws_volume_attachment" "engine_data" {
  count       = var.engine_enabled ? 1 : 0
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.engine_data.id
  instance_id = aws_instance.engine[0].id
}

resource "aws_instance" "worker" {
  count                  = var.worker_count
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.worker_type
  subnet_id              = data.aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.tailnet_only.id]
  key_name               = aws_key_pair.ag_mac.key_name
  iam_instance_profile   = aws_iam_instance_profile.ag.name
  metadata_options {
    http_tokens = "required"
  }
  root_block_device {
    volume_size = var.worker_root_gb
    volume_type = "gp3"
    encrypted   = true
  }
  user_data = templatefile("${path.module}/cloud-init.yaml.tftpl", merge(local.common, {
    hostname      = "ag-worker-${count.index + 1}"
    role          = "worker"
    ts_tags       = "tag:ag-worker"
    volume_device = ""
  }))
  tags = { Name = "ag-worker-${count.index + 1}", Role = "worker" }
  lifecycle { ignore_changes = [ami, user_data, key_name] }
}
