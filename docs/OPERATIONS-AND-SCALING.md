# Operating and Scaling Email Ingestion

## Diagnose the stage that failed

| Symptom | Check | Do not assume |
| --- | --- | --- |
| No scheduled runs | Correct workflow, enabled state, trigger and run history | A connected Gmail connection means polling is active |
| Empty successful run | Candidate search, configured rules and PDF qualification | Success means a document was submitted |
| Pagination limit | Stable query, page count, elapsed limit and remaining token | A truncated set is complete |
| Connector creation HTTP 500 | Resource creation stage and actual partial state | OAuth or email parsing caused a failure before either ran |
| Unauthorized connection | Current consent, account, scope and token lifecycle | Old activation proves present mailbox access |
| Repeated document | Immutable provider identity and the destination ledger | A second database already knows the first database's history |
| Pending quarantine | Defender result, object version, queue and scanner state | The API may mark the file clean |

Keep the historical enumerator and metadata workflows disabled unless a specific recovery requires them. Historical discovery reached 9,478 unique attachment-bearing messages, but this is an old inventory count, not a count of migrated, accepted or clean documents. Further historical attachment backfill was shelved.

## Growth and cost

Measure qualifying documents, all polled messages, pages, actions per run, attachment sizes, duplicate/conflict rates, time in quarantine and end-to-end completion. Consumption Logic Apps charge for executed work; extra polling, per-message actions and repeated failures can increase cost. Also account for storage, versions, scanning and logging. No current price estimate is implied.

The workflow's sequential loops simplify ordering and shared-variable use but limit throughput. Increasing concurrency requires safe loop state, database uniqueness and object-version checks. Larger discovery windows can hit page/time limits. A persisted cursor or bounded recovery windows may be warranted, but neither is silently added to this copied design.

The helper buffers attachments and caps decoded bytes at 20 MiB. Larger-file support needs memory, request-size, timeout, direct upload/finalization and malware-correlation design, not just a raised constant. Split resource boundaries only when access, scale or ownership justifies them.

## Recovery and security

Stop new submissions before reconciling partial work. Inspect committed rows, intake objects, scan state and promoted copies. Restore linked database/file state together; never reset a ledger to force a retry. Logs should retain counts, outcomes and hashes without email bodies, attachment bytes, OAuth tokens or signed callback URLs.

Read-only Gmail scope still grants mailbox read access. Filtering is not a permission boundary. A private Blob destination does not make mailbox processing compliant by itself; review data handling and records retention with the business owner.
