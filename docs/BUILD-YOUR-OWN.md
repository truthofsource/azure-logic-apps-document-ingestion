# Build your own from scratch: Azure Logic Apps Document Ingestion

Your own Logic App that reads approved email attachments into a private quarantine container, with a documented connector failure/fallback path.

Start with a new folder, your own files and your own accounts. The numbered steps below describe the build; no portfolio repository checkout is required. The existing implementation/evidence elsewhere in this repository is a separate reference, not a claim that your new build has already passed.

## Prerequisites

Your own mail account and permitted messages, Azure subscription, Logic App/connector permissions and private Blob storage. Managed connector support, consent restrictions and network access must be checked for your selected mailbox before building the full flow.

Use Bash on Linux/macOS/WSL for Bash blocks and PowerShell for PowerShell blocks. Select the tool versions supported by the official sources below, record the versions you actually install and retain generated dependency locks. Cloud resources, scanner downloads, logs and external AI calls can create costs; review the stated scope before enabling them.

## Create your project folder

Choose a new folder name. These first commands create a blank project; an optional `git init` gives it its own history. Create parent directories in your editor when a later step introduces a nested file.

```bash
mkdir my-azure-logic-apps-document-ingestion
cd my-azure-logic-apps-document-ingestion
git init
```

Create `.gitignore` before saving credentials or build outputs:

```gitignore
.venv/
node_modules/
.env
.env.*
local.settings.json
credentials.json
token.json
*.pem
*.key
*.tfstate*
*.tfplan
.terraform/
private*/
captures/
backups/
batch.json
reports/
out/
app-config.local.yaml
```

The source/file snippets are a starting implementation you type or paste into the named files. Replace `YOUR_*`, names, regions and addresses only with values from your own lab; do not place real client/employee records in a test project. Keep your terminal in this project root unless a step explicitly changes directory.

Before a first commit, set your own repository-local author with `git config user.name "YOUR_NAME"` and `git config user.email "YOUR_PUBLIC_COMMIT_EMAIL"`. Review `git status --short` and the staged diff before publishing; ignored local files are not a substitute for reviewing what you upload.

## Step 1 — Define the intake contract

**Where:** Your design notes.

Choose one mailbox/folder or label, allowed sender types, supported file types, maximum size and destination naming. Define a message-ID/attachment-ID key so retrying an email does not create a second business document.

**Check before continuing:** The flow has a precise source, filtering rule and duplicate key.

## Step 2 — Create private quarantine storage

**Where:** Azure Portal → Storage account → Containers.

Create a new private quarantine container with your selected retention, logging and network policy. Give the intended connector/workflow identity only its needed data access, and confirm the connector can reach this network path.

**Check before continuing:** The destination exists and the actual caller has a tested path; storage management access alone is not upload permission.

## Step 3 — Create the workflow and test the connector first

**Where:** Azure Portal → Logic Apps → Create → Designer.

Choose the hosting/connector model for your lab and add the mail trigger. Authorize only your intended mailbox and test one harmless email before adding business actions; a connector HTTP 500 is a failure to investigate, not proof that consent or credentials are wrong.

**Check before continuing:** A trigger run retrieves the intended harmless test message or records a specific connector failure.

## Step 4 — Add attachment filtering and controlled writes

**Where:** Logic App Designer.

Add the attachment loop, reject unsupported/oversized input and generate a stable destination key from message/attachment identifiers without traversal paths. Add Blob create/write using the tested connection; set bounded concurrency and a duplicate policy before enabling recurrent intake.

**Check before continuing:** One approved attachment produces one quarantined object; repeat delivery follows the chosen duplicate behavior.

## Step 5 — Keep scanning and business acceptance separate

**Where:** Workflow status and storage metadata.

Write Pending rather than Clean on receipt, then connect the actual scanner-result path and exact object version before enabling use of uploaded content. Record message receipt, storage write, scan verdict and business filing as separate states.

**Check before continuing:** Receiving a file cannot automatically authorize its download or complete a business checklist.

## Step 6 — Test failure and choose a supported fallback

**Where:** Run history and your own Google/Azure API setup.

Test revoked consent, an oversized attachment, a duplicate and an unreachable destination. If the managed connector is unsupported or repeatedly fails, document that conclusion and build a separate direct Gmail OAuth/API reader with protected credentials; do not present that alternative as a repaired Logic App connection.

**Check before continuing:** Your evidence identifies which path actually worked and preserves the failed connector lesson.

## Step 7 — Capture the flow and turn off the lab

**Where:** Logic App Overview / connections.

Save a value-free designer diagram, run outcomes and recovery instructions. Disable the trigger, remove only your lab connections/permissions and account for the plan, storage and log costs.

**Check before continuing:** No unintended email intake continues after the exercise.

## Verification and your own screenshots

| Evidence | What to record | Your result |
| --- | --- | --- |
| New build | Your own files/resource settings and tool versions | Not yet recorded |
| Working path | The actual successful request, configuration or recovery result | Not yet recorded |
| Failure boundary | A meaningful denied, malformed, stale or failed case | Not yet recorded |
| Recovery / cleanup | What you restored or removed and what remains billed | Not yet recorded |

Capture your own architecture/configuration, one working result and one failure/recovery result. Keep tokens, credentials, personal records and private identifiers out of public screenshots. The architecture diagram explains the design; record your own results rather than treating it as execution evidence.

## Troubleshooting order

1. Confirm the named file, working directory and selected tool/interpreter.
2. Check the exact input and resource/account selected for the failing step.
3. Separate identity permission, network/DNS reachability and application validation.
4. Keep the actual error and reconcile an unknown write outcome before repeating it; do not widen access or repeat paid operations blindly.

The numbered steps describe a build procedure. Local syntax checks, an accepted API request, a completed hosted operation and a human verification are different evidence levels; fill in the verification table with what you actually observed.

## Official implementation references

- [learn.microsoft.com — connectors-create-api-gmail](https://learn.microsoft.com/en-us/azure/connectors/connectors-create-api-gmail)
- [learn.microsoft.com — connectors-create-api-azureblobstorage](https://learn.microsoft.com/en-us/azure/connectors/connectors-create-api-azureblobstorage)
