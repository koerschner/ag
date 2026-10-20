# Tell the owner whenever anyone (any admin in the account, or the machine itself) touches the engine:
# console shells, disk snapshots/detach, stop/modify/terminate, changes to the ag-machine role or handing it out.
# CloudTrail management events reach EventBridge's default bus; matches go to an SNS topic emailing alert_email.
locals {
  engine_id   = var.engine_enabled ? aws_instance.engine[0].id : "none"
  engine_vols = compact([aws_ebs_volume.engine_data.id, var.engine_enabled ? aws_instance.engine[0].root_block_device[0].volume_id : ""])
  alerts_on   = var.alert_email != ""
}

resource "aws_sns_topic" "engine_alerts" {
  count = local.alerts_on ? 1 : 0
  name  = "ag-engine-alerts"
}
resource "aws_sns_topic_policy" "engine_alerts" {
  count = local.alerts_on ? 1 : 0
  arn   = aws_sns_topic.engine_alerts[0].arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "events.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.engine_alerts[0].arn
    }]
  })
}
resource "aws_sns_topic_subscription" "engine_alerts" {
  count     = local.alerts_on ? 1 : 0
  topic_arn = aws_sns_topic.engine_alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

locals {
  alert_patterns = {
    shell = { source = ["aws.ssm"], "detail-type" = ["AWS API Call via CloudTrail"],
      detail = { eventName = ["StartSession", "SendCommand"], requestParameters = { "$or" = [
    { target = [local.engine_id] }, { instanceIds = [local.engine_id] }] } } }
    disks = { source = ["aws.ec2"], "detail-type" = ["AWS API Call via CloudTrail"],
      detail = { eventName = ["CreateSnapshot", "DetachVolume", "ModifyVolume", "DeleteVolume"],
    requestParameters = { volumeId = local.engine_vols } } }
    instance = { source = ["aws.ec2"], "detail-type" = ["AWS API Call via CloudTrail"],
      detail = { "$or" = [
        { eventName = ["StopInstances", "TerminateInstances", "RebootInstances"], requestParameters = { instancesSet = { items = { instanceId = [local.engine_id] } } } },
        { eventName = ["ModifyInstanceAttribute", "ReplaceIamInstanceProfileAssociation", "CreateSnapshots", "CreateImage", "GetConsoleScreenshot", "SendSerialConsoleSSHPublicKey"],
        requestParameters = { "$or" = [{ instanceId = [local.engine_id] }, { instanceSpecification = { instanceId = [local.engine_id] } }] } },
    ] } }
    role = { source = ["aws.iam"], "detail-type" = ["AWS API Call via CloudTrail"],
      detail = { eventName = ["AttachRolePolicy", "DetachRolePolicy", "PutRolePolicy", "DeleteRolePolicy", "UpdateAssumeRolePolicy",
    "UpdateRole", "PutRolePermissionsBoundary", "DeleteRolePermissionsBoundary", "DeleteRole"], requestParameters = { roleName = [aws_iam_role.ag.name] } } }
    role_handout = { source = ["aws.ec2"], "detail-type" = ["AWS API Call via CloudTrail"],
      detail = { eventName = ["RunInstances", "AssociateIamInstanceProfile", "ReplaceIamInstanceProfileAssociation"],
    requestParameters = { iamInstanceProfile = { name = [aws_iam_instance_profile.ag.name] } } } }
  }
}

resource "aws_cloudwatch_event_rule" "engine_alerts" {
  for_each      = { for k, v in local.alert_patterns : k => jsonencode(v) if local.alerts_on }
  name          = "ag-engine-alert-${replace(each.key, "_", "-")}"
  description   = "Alert the owner: ${each.key} on the Ag engine"
  event_pattern = each.value
}
resource "aws_cloudwatch_event_target" "engine_alerts" {
  for_each = aws_cloudwatch_event_rule.engine_alerts
  rule     = each.value.name
  arn      = aws_sns_topic.engine_alerts[0].arn
  input_transformer {
    input_paths = {
      event = "$.detail.eventName", who = "$.detail.userIdentity.arn", ip = "$.detail.sourceIPAddress",
      time  = "$.detail.eventTime", params = "$.detail.requestParameters"
    }
    input_template = "\"Ag engine alert (${each.key}): <event> by <who> from <ip> at <time> UTC. Parameters: <params>\""
  }
}
