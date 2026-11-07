# Email Document Ingestion with Azure Logic Apps

**Move qualifying email attachments into protected business records without manually filing every message.**

[Business problem](#the-business-problem) · [Solution](#the-solution) · [Build issues](#what-went-wrong-and-what-we-learned) · [Proof](#proof-it-works) · [Commands](docs/COMMANDS.md)

![Local reference overview](docs/images/01-overview.png)

## The Business Problem

Important authorization documents arrived as email attachments. Leaving them in an inbox made filing, retrieval and audit preparation harder. Automatically downloading everything would create a different problem: unrelated files, duplicates and unchecked documents entering business records.

## The Solution

Use a scheduled Consumption Logic App to find candidate messages through a read-only Gmail connector. Have the application API inspect attachments within the message and check the approved sender, filename and any extra message rules. Retrieve only qualifying attachments, preserve their origin and place the files in a private quarantine container for malware checking.

**Business outcome:** A repeatable filing path ties each accepted document to its source and rule version. Duplicate protection reduces repeat processing when polling windows overlap. The project does not claim measured time savings or a complete mailbox migration.

## Architecture

```mermaid
flowchart LR
  Mail[Authorized Gmail inbox] --> Connector[Read-only custom connector]
  Connector --> Logic[Five-minute Logic App]
  Logic --> Planner[API checks message parts and filing rules]
  Planner --> Selected[Fetch selected attachment]
  Selected --> API[Inbound document API]
  API --> Ledger[SQL source records and duplicate protection]
  API --> Quarantine[Private Blob quarantine]
  Quarantine --> Scan[Separate Defender and scan-processing chain]
  Scan --> Trusted[Trusted document and metadata]
```

Gmail OAuth authorizes mailbox reads. The Logic App's managed identity authorizes calls to the application API. Those are separate permissions. The API requires an application role; its own authentication middleware handles access.

## What Was Built

| Component | Purpose | Included implementation |
| --- | --- | --- |
| Read-only Gmail contract | List messages, read a message and retrieve a selected attachment | [OpenAPI](contracts/gmail-readonly.openapi.json) |
| Scheduled ingestion process | Five-minute recurrence, fixed search per run, pagination, protected action history and managed-identity API calls | [Terraform](infra/logic-app/main.tf) |
| Attachment selection | Check nested message parts and select attachments that match exactly one configured rule | [Planner](src/planner/inboundgmailmessageplan.ts) |
| Upload validation and duplicate checks | Validate bytes and metadata; preserve raw attachment IDs; calculate fingerprints and duplicate identity | [Contract](src/contracts/inboundDocumentIngestion.ts), [rules](src/documents/inboundDocumentRules.ts) |
| API and database integration | SQL ledger, replay/conflict handling and full route dependencies | [Route](reference/inbounddocumentingestion-route.ts), [SQL](reference/037-inbound-document-ledger.sql) |
| Historical conclusions | Distinguish original ingestion repairs from the later MFA connector attempt | [Issues and conclusions](docs/ISSUES-AND-CONCLUSIONS.md) |

## What Went Wrong and What We Learned

| Problem | Conclusion or correction |
| --- | --- |
| Gmail attachment IDs exceeded a 200-character assumption | Keep the original ID intact. Use a domain-separated hash when a fixed-size database reference is needed. |
| Successful historical Logic App runs did not expose the expected retained Response output | The expected output was unavailable. A separate controlled read recovered the needed metadata instead of repeatedly requesting missing run output. |
| Recalculating a time-based search between pages moved the query boundary | The replacement source captures one query and reuses it on every page. The code correction is included; a live replacement test was not completed. |
| Replacement connector creation returned Azure HTTP 500 before OAuth | No confirmed connector root cause or successful replacement commissioning was established. Longer timeouts and valid OpenAPI alone were not a fix. |
| A later provider MFA effort encountered the connector problem too | Direct Gmail API access became the separate MFA solution. It did not repair or replace document ingestion. |

See [the linked Gmail access and MFA project](https://github.com/truthofsource/gmail-api-access-and-mfa-recovery) for that conclusion, OAuth lifecycle and the timestamp-precision repair.

## Proof It Works

### 1. Run the extracted rules

```bash
npm test
npm run demo
```

**Observed: 32 local code tests passed, with zero failures.** Tests exercise real selected source with fictional inputs. The demonstration shows nested PDF selection, missing and ambiguous rules, a long attachment ID, repeat identity and changed-byte fingerprints. It does not connect to Gmail or save a document.

![Actual local rule outputs with fictional metadata](docs/images/02-local-checks.png)

### 2. Inspect the historical conclusions

![Build issues and conclusions in the local reference](docs/images/03-conclusions.png)

A planned activation, an authorized mailbox connection and a verified replacement are different milestones. The [status and evidence guide](docs/VALIDATION.md) keeps them separate. A successful empty poll does not prove document ingestion or complete coverage.

### 3. Validate the disabled workflow definition

```bash
terraform -chdir=infra/logic-app init -backend=false
terraform -chdir=infra/logic-app fmt -check -recursive
terraform -chdir=infra/logic-app validate
terraform -chdir=infra/logic-app test
python -B scripts/preview.py --port 8141
```

Open [the local reference](http://127.0.0.1:8141). The Terraform tests use simulated Azure responses. By default, the example creates no workflow; choosing to create it still leaves its execution disabled. No `apply` is required or performed.

## Strengths, Weaknesses and Tradeoffs

| Choice | Strength | Limitation |
| --- | --- | --- |
| Logic Apps orchestration | Makes schedules and processing steps visible | Connector provisioning, consent and per-action costs remain dependencies |
| Deterministic classification | Avoids treating every email attachment as a business record | Rule changes require review; a sender header alone is not cryptographic sender proof |
| Overlapping searches and duplicate checks | Helps tolerate repeated discovery | A 15-minute lookback is not a durable cursor or outage recovery |
| Private quarantine | Keeps received bytes untrusted until checked | Scanner backlog and event failures need independent monitoring |
| Original IDs plus hashes | Keeps retrieval and database identities consistent | Keep the original attachment ID for retrieval and retry checks, even when a hash is used as a database reference |

## Guides

- [Implementation and identity boundaries](docs/IMPLEMENTATION.md)
- [Issues, investigation and conclusions](docs/ISSUES-AND-CONCLUSIONS.md)
- [Commands and clickops](docs/COMMANDS.md)
- [Operations, costs and scaling](docs/OPERATIONS-AND-SCALING.md)
- [Source map](docs/SOURCE-MAP.md)
- [Validation and evidence limits](docs/VALIDATION.md)

Actual implementation source is included with fictional organization labels. Screenshots show a new local reference, not fresh Azure acceptance. No mailbox access, backfill, service start, message or deployment is performed to publish this project. GitHub checks are manual-only.
