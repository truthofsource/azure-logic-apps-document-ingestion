variable "enable_nonproduction_gmail_connector" {
  description = "Create the Gmail connector and unauthenticated connection without starting workflows."
  type        = bool
  default     = false
}

variable "gmail_oauth_client_id" {
  description = "Google OAuth client approved for the replacement connector."
  type        = string
  default     = ""
  nullable    = false
}

variable "gmail_oauth_client_secret" {
  description = "Supply through a protected runtime input; never a tfvars file."
  type        = string
  default     = ""
  nullable    = false
  sensitive   = true
  ephemeral   = true

  validation {
    condition     = !var.enable_nonproduction_gmail_connector || trimspace(var.gmail_oauth_client_secret) != ""
    error_message = "Supply the OAuth client secret through a protected runtime input when creating or updating the connector."
  }
}

variable "gmail_oauth_client_secret_version" {
  description = "Increment when rotating the write-only Google OAuth client secret."
  type        = number
  default     = 1

  validation {
    condition     = var.gmail_oauth_client_secret_version >= 1 && floor(var.gmail_oauth_client_secret_version) == var.gmail_oauth_client_secret_version
    error_message = "The secret version must be a positive integer."
  }
}

resource "azapi_resource" "gmail_readonly_connector" {
  count     = var.enable_nonproduction_gmail_connector ? 1 : 0
  type      = "Microsoft.Web/customApis@2016-06-01"
  name      = local.gmail_document_ingestion_connector_name
  parent_id = azurerm_resource_group.app_nonproduction.id
  location  = azurerm_resource_group.app_nonproduction.location
  tags      = local.gmail_document_ingestion_tags

  # GlobalPerConnector is documented by the connector service and observed on
  # dev, but omitted from the embedded ARM schema for this API version.
  schema_validation_enabled = false
  response_export_values    = ["properties.connectionParameters.token.oAuthSettings.redirectUrl"]

  body = {
    properties = {
      displayName  = "Workforce nonproduction Gmail readonly"
      description  = "Read-only Gmail API surface for Layer 40 deterministic polling. Exposes only messages.list, messages.get, and messages.attachments.get."
      iconUri      = "https://defaulticons.powerapps.com/defaulticons/api-dedicated.svg"
      capabilities = []
      apiType      = "Rest"
      swagger      = jsondecode(file("${path.module}/contracts/gmail-readonly.openapi.json"))
      connectionParameters = {
        token = {
          type = "oauthSetting"
          oAuthSettings = {
            identityProvider = "google"
            clientId         = var.gmail_oauth_client_id
            scopes           = ["https://www.googleapis.com/auth/gmail.readonly"]
            redirectMode     = "GlobalPerConnector"
            customParameters = {}
            properties = {
              IsFirstParty               = "False"
              IsOnbehalfofLoginSupported = false
            }
          }
          uiDefinition = {
            displayName = "OAuth Connection"
            description = "OAuth Connection"
            constraints = { hidden = "false", required = "true" }
          }
        }
      }
    }
  }

  sensitive_body = {
    properties = {
      connectionParameters = {
        token = {
          oAuthSettings = {
            clientSecret = var.gmail_oauth_client_secret
          }
        }
      }
    }
  }
  sensitive_body_version = {
    "properties.connectionParameters.token.oAuthSettings.clientSecret" = tostring(var.gmail_oauth_client_secret_version)
  }

  lifecycle {
    prevent_destroy = true
    precondition {
      condition     = trimspace(var.gmail_oauth_client_id) != ""
      error_message = "An approved Google OAuth client ID is required before connector creation."
    }
  }

  timeouts {
    create = "3m"
    update = "3m"
    read   = "2m"
  }
}

resource "azapi_resource" "gmail_readonly_connection" {
  count     = var.enable_nonproduction_gmail_connector ? 1 : 0
  type      = "Microsoft.Web/connections@2016-06-01"
  name      = local.gmail_document_ingestion_connector_name
  parent_id = azurerm_resource_group.app_nonproduction.id
  location  = azurerm_resource_group.app_nonproduction.location
  tags      = local.gmail_document_ingestion_tags

  body = {
    properties = {
      displayName = "Workforce nonproduction Gmail readonly"
      api = {
        id = azapi_resource.gmail_readonly_connector[0].id
      }
    }
  }

  lifecycle {
    prevent_destroy = true
  }

  timeouts {
    create = "3m"
    update = "3m"
    read   = "2m"
  }
}

output "gmail_connector_redirect_url" {
  description = "Register this connector-specific callback with Google before interactive connection authorization."
  value       = var.enable_nonproduction_gmail_connector ? azapi_resource.gmail_readonly_connector[0].output.properties.connectionParameters.token.oAuthSettings.redirectUrl : null
}
