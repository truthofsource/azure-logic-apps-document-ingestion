locals {
  gmail_document_ingestion_logic_app_name = "logic-workforce-gmail-ingestion-production-centralus-001"

  gmail_document_ingestion_api_url = "https://${module.workforce_api.default_hostname}/api/inbound-documents"

  gmail_document_ingestion_planner_url = "https://${module.workforce_api.default_hostname}/api/inbound-gmail-message-plan"

  gmail_document_ingestion_source_mailbox_key = "workforce-gmail-primary"

  gmail_document_ingestion_connector_name = "gmail-workforce-ingestion-production-centralus-001"

  gmail_document_ingestion_connection_key = "gmail-readonly"

  gmail_document_ingestion_connection_id = "${azurerm_resource_group.application_production.id}/providers/Microsoft.Web/connections/${local.gmail_document_ingestion_connector_name}"

  gmail_document_ingestion_custom_api_id = "${azurerm_resource_group.application_production.id}/providers/Microsoft.Web/customApis/${local.gmail_document_ingestion_connector_name}"

  gmail_document_ingestion_tags = merge(local.common_tags, {
    workload    = "gmail-document-ingestion"
    data_class  = "sensitive"
    criticality = "high"
  })
}

# Layer 40C3 establishes only the disabled workload-identity shell.
# Gmail OAuth, Gmail API polling actions, the 15-minute overlap window,
# attachment selection, and the API action body remain later separately
# authorized implementation/commissioning work.
resource "azurerm_logic_app_workflow" "gmail_document_ingestion" {
  count               = var.enable_production_gmail_runtime ? 1 : 0
  name                = local.gmail_document_ingestion_logic_app_name
  location            = azurerm_resource_group.application_production.location
  resource_group_name = azurerm_resource_group.application_production.name

  enabled = false

  workflow_parameters = {
    "$connections" = jsonencode({
      defaultValue = {}
      type         = "Object"
    })
  }

  parameters = {
    "$connections" = jsonencode({
      (local.gmail_document_ingestion_connection_key) = {
        connectionId   = local.gmail_document_ingestion_connection_id
        connectionName = local.gmail_document_ingestion_connector_name
        id             = local.gmail_document_ingestion_custom_api_id
      }
    })
  }

  identity {
    type = "SystemAssigned"
  }

  tags = local.gmail_document_ingestion_tags
}

resource "azurerm_logic_app_trigger_recurrence" "gmail_document_ingestion_poll" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "gmail-poll-5m"
  logic_app_id = azurerm_logic_app_workflow.gmail_document_ingestion[0].id

  frequency = "Minute"
  interval  = 5
}

# Layer 40C11A adds only the first read-only Gmail API action while the workflow
# remains disabled. Pagination, message/MIME traversal, deterministic
# classification, attachment retrieval, and the Workforce POST remain later steps.
resource "azurerm_logic_app_action_custom" "gmail_document_ingestion_list_messages" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "List_Gmail_Messages"
  logic_app_id = azurerm_logic_app_workflow.gmail_document_ingestion[0].id

  body = jsonencode({
    type = "ApiConnection"

    inputs = {
      host = {
        connection = {
          name = "@parameters('$connections')['${local.gmail_document_ingestion_connection_key}']['connectionId']"
        }
      }

      method = "get"
      path   = "/users/@{encodeURIComponent('me')}/messages"

      queries = {
        q                = "has:attachment after:@{div(sub(ticks(addMinutes(utcNow(), -15)), ticks('1970-01-01T00:00:00Z')), 10000000)}"
        maxResults       = 100
        includeSpamTrash = false
      }
    }

    runAfter = {}

    runtimeConfiguration = {
      secureData = {
        properties = [
          "inputs",
          "outputs",
        ]
      }
    }
  })

  depends_on = [
    azurerm_logic_app_trigger_recurrence.gmail_document_ingestion_poll[0],
  ]
}

resource "azurerm_logic_app_action_custom" "gmail_document_ingestion_initialize_messages" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "Initialize_Gmail_Messages"
  logic_app_id = azurerm_logic_app_workflow.gmail_document_ingestion[0].id

  body = jsonencode({
    type = "InitializeVariable"

    inputs = {
      variables = [
        {
          name  = "Gmail_Messages"
          type  = "Array"
          value = "@coalesce(body('List_Gmail_Messages')?['messages'], json('[]'))"
        }
      ]
    }

    runAfter = {
      List_Gmail_Messages = [
        "Succeeded",
      ]
    }
  })

  depends_on = [
    azurerm_logic_app_action_custom.gmail_document_ingestion_list_messages[0],
  ]
}

resource "azurerm_logic_app_action_custom" "gmail_document_ingestion_initialize_page_token" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "Initialize_Gmail_Page_Token"
  logic_app_id = azurerm_logic_app_workflow.gmail_document_ingestion[0].id

  body = jsonencode({
    type = "InitializeVariable"

    inputs = {
      variables = [
        {
          name  = "Gmail_Page_Token"
          type  = "String"
          value = "@coalesce(body('List_Gmail_Messages')?['nextPageToken'], '')"
        }
      ]
    }

    runAfter = {
      Initialize_Gmail_Messages = [
        "Succeeded",
      ]
    }
  })

  depends_on = [
    azurerm_logic_app_action_custom.gmail_document_ingestion_initialize_messages[0],
  ]
}

resource "azurerm_logic_app_action_custom" "gmail_document_ingestion_paginate" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "Paginate_Gmail_Messages"
  logic_app_id = azurerm_logic_app_workflow.gmail_document_ingestion[0].id

  body = jsonencode({
    type       = "If"
    expression = "@not(empty(variables('Gmail_Page_Token')))"

    actions = {
      Until_All_Gmail_Pages = {
        type = "Until"

        expression = "@empty(variables('Gmail_Page_Token'))"

        limit = {
          count   = 60
          timeout = "PT10M"
        }

        operationOptions = "FailWhenLimitsReached"

        actions = {
          List_Gmail_Messages_Next_Page = {
            type = "ApiConnection"

            inputs = {
              host = {
                connection = {
                  name = "@parameters('$connections')['${local.gmail_document_ingestion_connection_key}']['connectionId']"
                }
              }

              method = "get"
              path   = "/users/@{encodeURIComponent('me')}/messages"

              queries = {
                q                = "has:attachment after:@{div(sub(ticks(addMinutes(utcNow(), -15)), ticks('1970-01-01T00:00:00Z')), 10000000)}"
                maxResults       = 100
                includeSpamTrash = false
                pageToken        = "@variables('Gmail_Page_Token')"
              }
            }

            runtimeConfiguration = {
              secureData = {
                properties = [
                  "inputs",
                  "outputs",
                ]
              }
            }

            runAfter = {}
          }

          Append_Next_Page_Messages = {
            type             = "Foreach"
            foreach          = "@coalesce(body('List_Gmail_Messages_Next_Page')?['messages'], json('[]'))"
            operationOptions = "Sequential"

            actions = {
              Append_Gmail_Message = {
                type = "AppendToArrayVariable"

                inputs = {
                  name  = "Gmail_Messages"
                  value = "@item()"
                }

                runAfter = {}
              }
            }

            runAfter = {
              List_Gmail_Messages_Next_Page = [
                "Succeeded",
              ]
            }
          }

          Set_Gmail_Page_Token = {
            type = "SetVariable"

            inputs = {
              name  = "Gmail_Page_Token"
              value = "@coalesce(body('List_Gmail_Messages_Next_Page')?['nextPageToken'], '')"
            }

            runAfter = {
              Append_Next_Page_Messages = [
                "Succeeded",
              ]
            }
          }
        }

        runAfter = {}
      }
    }

    else = {
      actions = {}
    }

    runAfter = {
      Initialize_Gmail_Page_Token = [
        "Succeeded",
      ]
    }
  })

  depends_on = [
    azurerm_logic_app_action_custom.gmail_document_ingestion_initialize_page_token[0],
  ]
}

resource "azurerm_logic_app_action_custom" "gmail_document_ingestion_process_messages" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "Process_Gmail_Messages"
  logic_app_id = azurerm_logic_app_workflow.gmail_document_ingestion[0].id

  body = jsonencode({
    type             = "Foreach"
    foreach          = "@variables('Gmail_Messages')"
    operationOptions = "Sequential"

    actions = {
      Get_Gmail_Message = {
        type = "ApiConnection"

        inputs = {
          host = {
            connection = {
              name = "@parameters('$connections')['${local.gmail_document_ingestion_connection_key}']['connectionId']"
            }
          }

          method = "get"
          path   = "/users/@{encodeURIComponent('me')}/messages/@{encodeURIComponent(items('Process_Gmail_Messages')?['id'])}"

          queries = {
            format = "full"
          }
        }

        runtimeConfiguration = {
          secureData = {
            properties = [
              "inputs",
              "outputs",
            ]
          }
        }

        runAfter = {}
      }

      Plan_Gmail_Message = {
        type = "Http"

        inputs = {
          method = "POST"
          uri    = local.gmail_document_ingestion_planner_url

          headers = {
            "Content-Type" = "application/json"
          }

          body = "@body('Get_Gmail_Message')"

          authentication = {
            type     = "ManagedServiceIdentity"
            audience = local.workforce_api_app_id_uri
          }
        }

        runtimeConfiguration = {
          secureData = {
            properties = [
              "inputs",
              "outputs",
            ]
          }
        }

        runAfter = {
          Get_Gmail_Message = [
            "Succeeded",
          ]
        }
      }

      Process_Eligible_Attachments = {
        type             = "Foreach"
        foreach          = "@coalesce(body('Plan_Gmail_Message')?['eligibleAttachments'], json('[]'))"
        operationOptions = "Sequential"

        actions = {
          Get_Gmail_Attachment = {
            type = "ApiConnection"

            inputs = {
              host = {
                connection = {
                  name = "@parameters('$connections')['${local.gmail_document_ingestion_connection_key}']['connectionId']"
                }
              }

              method = "get"
              path   = "/users/@{encodeURIComponent('me')}/messages/@{encodeURIComponent(items('Process_Gmail_Messages')?['id'])}/attachments/@{encodeURIComponent(items('Process_Eligible_Attachments')?['sourceAttachmentId'])}"
            }

            runtimeConfiguration = {
              secureData = {
                properties = [
                  "inputs",
                  "outputs",
                ]
              }
            }

            runAfter = {}
          }

          Submit_Inbound_Document = {
            type = "Http"

            inputs = {
              method = "POST"
              uri    = local.gmail_document_ingestion_api_url

              headers = {
                "Content-Type" = "application/json"
              }

              body = {
                sourceMailboxKey      = local.gmail_document_ingestion_source_mailbox_key
                sourceClassifier      = "@items('Process_Eligible_Attachments')?['sourceClassifier']"
                classifierRuleVersion = "@items('Process_Eligible_Attachments')?['classifierRuleVersion']"
                sourceMessageId       = "@items('Process_Eligible_Attachments')?['sourceMessageId']"
                sourceThreadId        = "@items('Process_Eligible_Attachments')?['sourceThreadId']"
                sourceAttachmentId    = "@items('Process_Eligible_Attachments')?['sourceAttachmentId']"
                senderAddress         = "@items('Process_Eligible_Attachments')?['senderAddress']"
                receivedAtUtc         = "@items('Process_Eligible_Attachments')?['receivedAtUtc']"
                originalFileName      = "@items('Process_Eligible_Attachments')?['originalFileName']"
                contentType           = "@items('Process_Eligible_Attachments')?['contentType']"
                correlationId         = "@workflow()['run']['name']"

                contentBase64 = "@if(equals(mod(length(coalesce(body('Get_Gmail_Attachment')?['data'], '')), 4), 1), '!', concat(replace(replace(coalesce(body('Get_Gmail_Attachment')?['data'], ''), '-', '+'), '_', '/'), if(equals(mod(length(coalesce(body('Get_Gmail_Attachment')?['data'], '')), 4), 2), '==', if(equals(mod(length(coalesce(body('Get_Gmail_Attachment')?['data'], '')), 4), 3), '=', ''))))"
              }

              authentication = {
                type     = "ManagedServiceIdentity"
                audience = local.workforce_api_app_id_uri
              }
            }

            runtimeConfiguration = {
              secureData = {
                properties = [
                  "inputs",
                  "outputs",
                ]
              }
            }

            runAfter = {
              Get_Gmail_Attachment = [
                "Succeeded",
              ]
            }
          }
        }

        runAfter = {
          Plan_Gmail_Message = [
            "Succeeded",
          ]
        }
      }
    }

    runAfter = {
      Paginate_Gmail_Messages = [
        "Succeeded",
      ]
    }
  })

  depends_on = [
    azurerm_logic_app_action_custom.gmail_document_ingestion_paginate[0],
  ]
}

resource "azuread_app_role_assignment" "gmail_document_ingestion_api_ingestion_writer" {
  count       = var.enable_production_gmail_runtime ? 1 : 0
  app_role_id = local.workforce_ingestion_writer_app_role_id

  principal_object_id = azurerm_logic_app_workflow.gmail_document_ingestion[0].identity[0].principal_id
  resource_object_id  = azuread_service_principal.workforce_api.object_id
}

output "gmail_document_ingestion_logic_app_name" {
  description = "Disabled Consumption Logic App shell reserved for deterministic Gmail document ingestion."
  value       = var.enable_production_gmail_runtime ? azurerm_logic_app_workflow.gmail_document_ingestion[0].name : null
}

output "gmail_document_ingestion_logic_app_principal_id" {
  description = "System-assigned managed identity principal ID for the Gmail ingestion Logic App."
  value       = var.enable_production_gmail_runtime ? azurerm_logic_app_workflow.gmail_document_ingestion[0].identity[0].principal_id : null
}

output "gmail_document_ingestion_api_url" {
  description = "Workforce application-only inbound-document API endpoint reserved for the Gmail ingestion Logic App."
  value       = local.gmail_document_ingestion_api_url
}

output "gmail_document_quarantine_container_name" {
  description = "Private shared-intake Blob container used only for pre-trust Gmail attachment quarantine."
  value       = module.stage2.gmail_quarantine_container_name
}

output "workforce_ingestion_writer_app_role_id" {
  description = "Application-only Workforce app-role ID assigned to the Gmail ingestion Logic App identity."
  value       = local.workforce_ingestion_writer_app_role_id
}

output "workforce_ingestion_writer_app_role_value" {
  description = "Application-only Workforce role value required by the inbound-document ingestion endpoint."
  value       = "Workforce.IngestionWriter"
}

# BEGIN LAYER40E12 MCO ALL-HISTORY ENUMERATOR
#
# Historical MCO authorization discovery is intentionally separate from the
# normal 5-minute / 15-minute-overlap Gmail ingestion workflow.
#
# This disabled operator-controlled workflow enumerates exactly one Gmail
# ListMessages page per invocation. The caller supplies the prior nextPageToken
# (or omits it for the first page), persists the returned inventory, and resumes
# with the returned nextPageToken. Relevance is NOT decided by this query; the
# shared Workforce MCO classifier remains authoritative during later processing.
locals {
  gmail_mco_history_enumerator_logic_app_name = "logic-workforce-gmail-mco-history-production-centralus-001"

  gmail_mco_history_enumerator_tags = merge(local.gmail_document_ingestion_tags, {
    workload = "gmail-mco-history-enumerator"
  })
}

resource "azurerm_logic_app_workflow" "gmail_mco_history_enumerator" {
  count               = var.enable_production_gmail_runtime ? 1 : 0
  name                = local.gmail_mco_history_enumerator_logic_app_name
  location            = azurerm_resource_group.application_production.location
  resource_group_name = azurerm_resource_group.application_production.name

  enabled = false

  workflow_parameters = {
    "$connections" = jsonencode({
      defaultValue = {}
      type         = "Object"
    })
  }

  parameters = {
    "$connections" = jsonencode({
      (local.gmail_document_ingestion_connection_key) = {
        connectionId   = local.gmail_document_ingestion_connection_id
        connectionName = local.gmail_document_ingestion_connector_name
        id             = local.gmail_document_ingestion_custom_api_id
      }
    })
  }

  tags = local.gmail_mco_history_enumerator_tags
}

resource "azurerm_logic_app_trigger_http_request" "gmail_mco_history_enumerator_manual" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "Enumerate_MCO_History_Page"
  logic_app_id = azurerm_logic_app_workflow.gmail_mco_history_enumerator[0].id
  method       = "POST"

  schema = jsonencode({
    type                 = "object"
    additionalProperties = false

    properties = {
      gmailQuery = {
        type = "string"
        enum = [
          "has:attachment",
          "has:attachment from:adobesign@adobesign.com",
          "has:attachment from:dse@docusign.net",
          "has:attachment from:bcbst.com",
        ]
      }

      pageToken = {
        type = "string"
      }
    }
  })
}

resource "azurerm_logic_app_action_custom" "gmail_mco_history_enumerator_list_messages" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "List_MCO_Historical_Gmail_Messages"
  logic_app_id = azurerm_logic_app_workflow.gmail_mco_history_enumerator[0].id

  body = jsonencode({
    type = "ApiConnection"

    inputs = {
      host = {
        connection = {
          name = "@parameters('$connections')['${local.gmail_document_ingestion_connection_key}']['connectionId']"
        }
      }

      method = "get"
      path   = "/users/@{encodeURIComponent('me')}/messages"

      queries = {
        q                = "@coalesce(triggerBody()?['gmailQuery'], 'has:attachment')"
        maxResults       = 100
        includeSpamTrash = false
        pageToken        = "@coalesce(triggerBody()?['pageToken'], '')"
      }
    }

    runAfter = {}

    runtimeConfiguration = {
      secureData = {
        properties = [
          "inputs",
          "outputs",
        ]
      }
    }
  })

  depends_on = [
    azurerm_logic_app_trigger_http_request.gmail_mco_history_enumerator_manual[0],
  ]
}

resource "azurerm_logic_app_action_custom" "gmail_mco_history_enumerator_return_page" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "Return_MCO_History_Page"
  logic_app_id = azurerm_logic_app_workflow.gmail_mco_history_enumerator[0].id

  body = jsonencode({
    type = "Response"
    kind = "Http"

    inputs = {
      statusCode = 200

      body = {
        messages         = "@coalesce(body('List_MCO_Historical_Gmail_Messages')?['messages'], json('[]'))"
        nextPageToken    = "@coalesce(body('List_MCO_Historical_Gmail_Messages')?['nextPageToken'], '')"
        query            = "@coalesce(triggerBody()?['gmailQuery'], 'has:attachment')"
        maxResults       = 100
        includeSpamTrash = false
      }
    }

    runAfter = {
      List_MCO_Historical_Gmail_Messages = [
        "Succeeded",
      ]
    }

    runtimeConfiguration = {
      secureData = {
        properties = [
          "inputs",
        ]
      }
    }
  })

  depends_on = [
    azurerm_logic_app_action_custom.gmail_mco_history_enumerator_list_messages[0],
  ]
}
# END LAYER40E12 MCO ALL-HISTORY ENUMERATOR

# BEGIN LAYER40E24 MCO HISTORICAL METADATA ENRICHER
#
# This workflow is separate from the completed all-history page enumerator.
# It is disabled by default and accepts exactly one already-inventoried Gmail
# message ID per future operator-controlled invocation.
#
# GetMessage uses format=full because that is the established custom-connector
# contract. Its action inputs/outputs are secured. The HTTP response deliberately
# exposes only a normalizedName metadata envelope and omits payload.body, payload.parts,
# and any MessagePartBody data. A later separately reviewed stage can decide how
# much additional MIME metadata is necessary before classification.
locals {
  gmail_mco_history_metadata_enricher_logic_app_name = "logic-workforce-gmail-mco-metadata-production-centralus-001"

  gmail_mco_history_metadata_enricher_tags = merge(local.gmail_document_ingestion_tags, {
    workload = "gmail-mco-history-metadata-enricher"
  })
}

resource "azurerm_logic_app_workflow" "gmail_mco_history_metadata_enricher" {
  count               = var.enable_production_gmail_runtime ? 1 : 0
  name                = local.gmail_mco_history_metadata_enricher_logic_app_name
  location            = azurerm_resource_group.application_production.location
  resource_group_name = azurerm_resource_group.application_production.name

  enabled = false

  workflow_parameters = {
    "$connections" = jsonencode({
      defaultValue = {}
      type         = "Object"
    })
  }

  parameters = {
    "$connections" = jsonencode({
      (local.gmail_document_ingestion_connection_key) = {
        connectionId   = local.gmail_document_ingestion_connection_id
        connectionName = local.gmail_document_ingestion_connector_name
        id             = local.gmail_document_ingestion_custom_api_id
      }
    })
  }

  tags = local.gmail_mco_history_metadata_enricher_tags
}

resource "azurerm_logic_app_trigger_http_request" "gmail_mco_history_metadata_enricher_manual" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "Enrich_MCO_Historical_Gmail_Message_Metadata"
  logic_app_id = azurerm_logic_app_workflow.gmail_mco_history_metadata_enricher[0].id
  method       = "POST"

  schema = jsonencode({
    type                 = "object"
    additionalProperties = false
    required             = ["messageId"]

    properties = {
      messageId = {
        type      = "string"
        minLength = 1
      }
    }
  })
}

resource "azurerm_logic_app_action_custom" "gmail_mco_history_metadata_enricher_get_message" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "Get_MCO_Historical_Gmail_Message"
  logic_app_id = azurerm_logic_app_workflow.gmail_mco_history_metadata_enricher[0].id

  body = jsonencode({
    type = "ApiConnection"

    inputs = {
      host = {
        connection = {
          name = "@parameters('$connections')['${local.gmail_document_ingestion_connection_key}']['connectionId']"
        }
      }

      method = "get"
      path   = "/users/@{encodeURIComponent('me')}/messages/@{encodeURIComponent(triggerBody()?['messageId'])}"

      queries = {
        format = "full"
      }
    }

    runAfter = {}

    runtimeConfiguration = {
      secureData = {
        properties = [
          "inputs",
          "outputs",
        ]
      }
    }
  })

  depends_on = [
    azurerm_logic_app_trigger_http_request.gmail_mco_history_metadata_enricher_manual[0],
  ]
}

resource "azurerm_logic_app_action_custom" "gmail_mco_history_metadata_enricher_return_metadata" {
  count        = var.enable_production_gmail_runtime ? 1 : 0
  name         = "Return_MCO_Historical_Gmail_Message_Metadata"
  logic_app_id = azurerm_logic_app_workflow.gmail_mco_history_metadata_enricher[0].id

  body = jsonencode({
    type = "Response"
    kind = "Http"

    inputs = {
      statusCode = 200

      body = {
        id           = "@coalesce(body('Get_MCO_Historical_Gmail_Message')?['id'], '')"
        threadId     = "@coalesce(body('Get_MCO_Historical_Gmail_Message')?['threadId'], '')"
        internalDate = "@coalesce(body('Get_MCO_Historical_Gmail_Message')?['internalDate'], '')"
        labelIds     = "@coalesce(body('Get_MCO_Historical_Gmail_Message')?['labelIds'], json('[]'))"
        sizeEstimate = "@coalesce(body('Get_MCO_Historical_Gmail_Message')?['sizeEstimate'], 0)"
        headers      = "@coalesce(body('Get_MCO_Historical_Gmail_Message')?['payload']?['headers'], json('[]'))"
        rootMimeType = "@coalesce(body('Get_MCO_Historical_Gmail_Message')?['payload']?['mimeType'], '')"
        rootFilename = "@coalesce(body('Get_MCO_Historical_Gmail_Message')?['payload']?['filename'], '')"
      }
    }

    runAfter = {
      Get_MCO_Historical_Gmail_Message = [
        "Succeeded",
      ]
    }

    runtimeConfiguration = {
      secureData = {
        properties = [
          "inputs",
        ]
      }
    }
  })

  depends_on = [
    azurerm_logic_app_action_custom.gmail_mco_history_metadata_enricher_get_message[0],
  ]
}
# END LAYER40E24 MCO HISTORICAL METADATA ENRICHER
