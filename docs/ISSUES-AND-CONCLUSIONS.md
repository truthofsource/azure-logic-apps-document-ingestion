# Issues, Investigation and Conclusions

These are recorded implementation lessons, not a fresh production investigation. Organization/provider labels are generalized. The original document workflow and later MFA recovery are related integrations, not one interchangeable deployment.

| Stage | Evidence | Conclusion |
| --- | --- | --- |
| Original document ingestion | Long Gmail attachment IDs exceeded a legacy 200-character assumption | Preserve the complete opaque ID; use a separate domain-separated persistence hash |
| Historical run inspection | Some successful Response actions had no retrievable saved output | Use the available system records and a controlled read of the needed source metadata; do not invent a missing output link |
| Replacement polling review | A rolling `after:` query could move between pages | Capture one query per enumeration; retain full-pagination failure behavior |
| Replacement document connector | Azure connector creation returned InternalServerError before OAuth | The replacement could not be put into service; mailbox migration and a complete handover were not verified |
| Later provider MFA connector attempt, October 21 | Public OpenAPI validation passed, but connector creation still returned repeated HTTP 500 and timed out | Validation was necessary but not sufficient; the service's underlying root cause remained unknown |
| Support attempt | The submission was initially accepted, then failed with InvalidSupportPlan; no opened case was confirmed | An accepted asynchronous submission was not an opened support ticket |
| MFA implementation conclusion | Approved direct Gmail API access avoided connector creation; authorization stayed protected in Key Vault | Direct retrieval became the MFA path; it did not fix the document connector |
| OAuth lifecycle | Testing status and missing branding initially prevented a durable production-mode setup | Complete required branding, select the intended publishing status and renew consent; do not confuse this with the pre-OAuth HTTP 500 |
| Recovery timing, October 22–23 | A real arrival could be rounded to the same second as millisecond Send time and be rejected as too old | Share one precise freshness comparison before verification and final selection; keep older/ambiguous messages rejected |
| Competing sign-ins | A normal browser can request another code in the same inbox | Ambiguous candidates require manual recovery; do not pick the newest code by guesswork |

## What was solved

The attachment-ID contract and fixed-width reference were corrected in source. The later replacement source fixed the moving-query issue. The direct MFA runtime removed its dependency on Azure custom-connector creation, and the recorded precision repair passed a bounded Admin reconnect and saved-session reuse check.

## What was not solved by those changes

No confirmed service root cause or successful replacement connector creation was established. Matching OAuth client details did not authorize a new connection or mailbox. MFA success did not establish cross-database document-ledger continuity or a completed Logic Apps handover. A single successful reconnect did not guarantee every future automatic recovery.

## Before retrying a connector

Confirm the exact resource, failure stage, supported contract and actual Azure state. A longer timeout, valid icon or valid OpenAPI is not evidence that the creation failure is repaired. Keep workflows disabled until consent, identity, destination, processing-history continuity and scan delivery have been established. Never broaden Gmail permissions or switch inboxes merely to make a test pass.

## Before recovering a processing gap

Find the last time range confirmed fully processed, stop overlapping ingestion jobs and check unfinished work. Plan a recovery scan for a fixed time range, keeping the original provider IDs and destination processing records. Do not restart the shelved historical backfill automatically. Keep the original operation record. Do not repeat a business operation just to obtain a cleaner test result.
