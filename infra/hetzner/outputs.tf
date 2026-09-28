output "brain" {
  value = var.brain_enabled ? { name = hcloud_server.brain[0].name, type = hcloud_server.brain[0].server_type, ipv4 = hcloud_server.brain[0].ipv4_address } : null
}
output "workers" {
  value = [for w in hcloud_server.worker : { name = w.name, type = w.server_type }]
}
