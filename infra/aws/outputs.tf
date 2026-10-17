output "engine" {
  value = var.engine_enabled ? { name = aws_instance.engine[0].tags.Name, id = aws_instance.engine[0].id, type = aws_instance.engine[0].instance_type, ipv4 = aws_instance.engine[0].public_ip } : null
}
output "workers" {
  value = [for w in aws_instance.worker : { name = w.tags.Name, id = w.id, type = w.instance_type, location = w.availability_zone }]
}
