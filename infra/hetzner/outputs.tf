output "engine" {
  value = var.engine_enabled ? { name = hcloud_server.engine[0].name, type = hcloud_server.engine[0].server_type, ipv4 = hcloud_server.engine[0].ipv4_address } : null
}
output "workers" {
  value = [for w in hcloud_server.worker : { name = w.name, type = w.server_type }]
}
