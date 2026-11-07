# From Inbox to a Protected Document

## Discovery is not acceptance

The workflow runs every five minutes and looks back fifteen minutes for attachment-bearing messages. It asks for up to 100 message IDs per page and follows page tokens. The replacement source captures its query once before paging. Processing waits until enumeration succeeds; hitting the 60-page or ten-minute boundary fails the run rather than presenting a partial result as complete.

The lookback deliberately overlaps earlier polls. The SQL ledger prevents an already-known provider message/attachment from becoming a new document. This is not an exactly-once delivery guarantee across all failures or databases. An interruption longer than the lookback needs an explicitly scoped coverage/reconciliation plan.

## Selection and content

`GetMessage(format=full)` provides nested MIME parts: the structured sections inside an email. The planner traverses those parts, requires an attachment ID and matches configured sender addresses/domains, filename tokens and optional transient text signals. Exactly one rule must match each qualifying attachment. A message can contain several independently qualifying attachments; the rule does not require exactly one attachment per message.

Missing or ambiguous rules yield no eligible attachment. Sender/header matching here is deterministic classification, not DKIM verification or a full sender-authentication decision. Do not describe this document planner as providing the stronger raw-message proof used in the separate MFA integration.

The authorization-document profile is PDF-only. The generic preparation code can also recognize JPEG and PNG for other approved classifiers; that does not activate an unconfigured classifier. Background-report profiles were intentionally left empty at the historical closeout.

Gmail attachment data uses base64url. The workflow normalizes the URL-safe alphabet and padding before submitting ordinary base64 to the inbound API. The API independently checks canonical encoding, the 20 MiB decoded bound, filename/MIME/signature agreement, sender address and received timestamp. A valid file header is not a malware verdict or a complete PDF/image parse.

## Identity and provenance

Gmail OAuth is a mailbox authorization. The workflow's managed identity is a different identity used for API calls. The original full route requires an ingestion-writer application role. Creating a workflow identity does not grant that role; the public runnable extraction deliberately omits app registration, role assignment, connector creation, database and scanner provisioning.

Preserve the raw provider attachment ID, up to the contract's 8,192-character bound, for retrieval and duplicate identity. A domain-separated SHA-256 converts it to a fixed-size persistence reference. The content SHA-256 describes the received bytes. These values serve different purposes. Do not derive replay identity from the already-hashed attachment reference.

The full route distinguishes an exact replay from different bytes under an existing identity. SQL and Blob Storage are separate systems: a committed receipt, pending scan and partial upload need reconciliation rather than blind re-submission.

## Trust and history

New bytes go to private Gmail quarantine. Defender produces the malware result; Event Grid and a queue carry it; the trusted processor checks the expected object/version and state before release. No OCR result, sender label, successful poll or manual operator assumption makes a file clean.

Historical records describe prospective activation of an earlier environment. Replacement commissioning remained deferred after connector creation failed and continuity evidence was incomplete. That is not contradicted by keeping the original implementation code. No current live-state check or activation is performed for this project.

References: [Gmail attachment body format](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages.attachments), [message listing](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list), [Gmail filtering](https://developers.google.com/workspace/gmail/api/guides/filtering), [Microsoft Gmail connector restrictions](https://learn.microsoft.com/en-us/connectors/gmail/).
