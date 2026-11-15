variable "enabled" {
  type    = bool
  default = false
}

variable "name" {
  type    = string
  default = "logic-example-documents"
}

variable "location" {
  type    = string
  default = "eastus2"
}

variable "resource_group_name" {
  type    = string
  default = "rg-example-application"
}

variable "ingestion_api_url" {
  type    = string
  default = "https://api.example.invalid/api/inbound-documents"
}

variable "planner_api_url" {
  type    = string
  default = "https://api.example.invalid/api/inbound-gmail-message-plan"
}

variable "api_audience" {
  type    = string
  default = "api://00000000-0000-0000-0000-000000000001"
}

variable "source_mailbox_key" {
  type    = string
  default = "fictional-operations-inbox"
}

variable "connector_name" {
  type    = string
  default = "gmail-example-readonly"
}

variable "connection_id" {
  type    = string
  default = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-example-application/providers/Microsoft.Web/connections/gmail-example-readonly"
}

variable "custom_api_id" {
  type    = string
  default = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/rg-example-application/providers/Microsoft.Web/customApis/gmail-example-readonly"
}

variable "tags" {
  type    = map(string)
  default = { purpose = "public-reference" }
}
