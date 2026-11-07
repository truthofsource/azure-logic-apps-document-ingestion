mock_provider "azurerm" {}
run "no_resources_by_default" {
  command = plan
  assert {
    condition     = length(azurerm_logic_app_workflow.gmail_document_ingestion) == 0
    error_message = "The reference must default Off."
  }
}
run "prepared_workflow_stays_disabled" {
  command = plan
  variables { enabled = true }
  assert {
    condition     = azurerm_logic_app_workflow.gmail_document_ingestion[0].enabled == false && azurerm_logic_app_trigger_recurrence.gmail_document_ingestion_poll[0].interval == 5
    error_message = "Creating the definition must not activate polling."
  }
  assert {
    condition     = jsondecode(azurerm_logic_app_action_custom.gmail_document_ingestion_list_messages[0].body).inputs.queries.q == "@outputs('Compose_Gmail_Poll_Query')"
    error_message = "Capture and reuse a fixed query for each run."
  }
  assert {
    condition = (
      jsondecode(azurerm_logic_app_action_custom.gmail_document_ingestion_paginate[0].body).actions.Until_All_Gmail_Pages.actions.List_Gmail_Messages_Next_Page.inputs.queries.q == "@outputs('Compose_Gmail_Poll_Query')" &&
      jsondecode(azurerm_logic_app_action_custom.gmail_document_ingestion_paginate[0].body).actions.Until_All_Gmail_Pages.operationOptions == "FailWhenLimitsReached"
    )
    error_message = "Later pages must retain the original query and a limit hit must fail."
  }
  assert {
    condition     = jsondecode(azurerm_logic_app_action_custom.gmail_document_ingestion_process_messages[0].body).actions.Plan_Gmail_Message.inputs.authentication.type == "ManagedServiceIdentity"
    error_message = "API calls must use the workflow identity."
  }
  assert {
    condition     = contains(jsondecode(azurerm_logic_app_action_custom.gmail_document_ingestion_list_messages[0].body).runtimeConfiguration.secureData.properties, "outputs")
    error_message = "Do not expose message outputs in run history."
  }
}
