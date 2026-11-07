locals {
  gmail_document_ingestion_logic_app_name     = var.name
  gmail_document_ingestion_api_url            = var.ingestion_api_url
  gmail_document_ingestion_planner_url        = var.planner_api_url
  gmail_document_ingestion_source_mailbox_key = var.source_mailbox_key
  gmail_document_ingestion_connection_key     = "gmail-readonly"
  gmail_document_ingestion_connection_id      = var.connection_id
  gmail_document_ingestion_connector_name     = var.connector_name
  gmail_document_ingestion_custom_api_id      = var.custom_api_id
  gmail_document_ingestion_tags               = var.tags
}
resource "azurerm_logic_app_workflow" "gmail_document_ingestion" {
  count               = var.enabled ? 1 : 0
  name                = local.gmail_document_ingestion_logic_app_name
  location            = var.location
  resource_group_name = var.resource_group_name

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
  count        = var.enabled ? 1 : 0
  name         = "gmail-poll-5m"
  logic_app_id = azurerm_logic_app_workflow.gmail_document_ingestion[0].id

  frequency = "Minute"
  interval  = 5
}

# Capture the overlap query once so pagination cannot move its time boundary.
resource "azurerm_logic_app_action_custom" "gmail_document_ingestion_poll_query" {
  count        = var.enabled ? 1 : 0
  name         = "Compose_Gmail_Poll_Query"
  logic_app_id = azurerm_logic_app_workflow.gmail_document_ingestion[0].id

  body = jsonencode({
    type     = "Compose"
    inputs   = "has:attachment after:@{div(sub(ticks(addMinutes(utcNow(), -15)), ticks('1970-01-01T00:00:00Z')), 10000000)}"
    runAfter = {}
  })

  depends_on = [
    azurerm_logic_app_trigger_recurrence.gmail_document_ingestion_poll[0],
  ]
}

resource "azurerm_logic_app_action_custom" "gmail_document_ingestion_list_messages" {
  count        = var.enabled ? 1 : 0
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
        q                = "@outputs('Compose_Gmail_Poll_Query')"
        maxResults       = 100
        includeSpamTrash = false
      }
    }

    runAfter = {
      Compose_Gmail_Poll_Query = ["Succeeded"]
    }

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
    azurerm_logic_app_action_custom.gmail_document_ingestion_poll_query[0],
  ]
}

resource "azurerm_logic_app_action_custom" "gmail_document_ingestion_initialize_messages" {
  count        = var.enabled ? 1 : 0
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
  count        = var.enabled ? 1 : 0
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
  count        = var.enabled ? 1 : 0
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
                q                = "@outputs('Compose_Gmail_Poll_Query')"
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
  count        = var.enabled ? 1 : 0
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
            audience = var.api_audience
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
                audience = var.api_audience
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
