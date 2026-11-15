# Commands and Clickops

## Local checks

Node 22.23.2 or newer and Python 3.12 are used. No npm dependency install is required. Every external request in the transport tests is a fake response.

```bash
npm test
npm run demo
python -B scripts/preview.py --port 8141
```

Open `http://127.0.0.1:8141` and use the three tabs. Ctrl+C stops the loopback-only viewer. It accepts no uploaded messages, credentials or codes. Run the two project viewers on different ports if both are needed at once.

## Terraform inspection without deployment

```bash
terraform -chdir=infra/logic-app init -backend=false
terraform -chdir=infra/logic-app fmt -check -recursive
terraform -chdir=infra/logic-app validate
terraform -chdir=infra/logic-app test
```

These tests simulate provider responses. Do not use `apply` to reproduce an old incident or activate historical components. Initialization may download signed provider packages; it does not require an Azure login.

## Read-only Azure portal inspection

In Azure Portal, confirm the subscription and exact resource first. For a Logic App, inspect Overview and Runs history. A Succeeded run may have no qualifying documents. For an API connection, inspect its current status; do not click Authorize or change the mailbox during an evidence review. For a failed resource creation, inspect the activity log operation and whether any resource actually remains.

Do not capture secure action outputs, signed callback URLs or real mailbox contents in screenshots. The public screenshots here are local references and never use those resources.

## Google Cloud inspection

In the authorized Google project, inspect Google Auth Platform → Audience, Branding and Clients. Check the application's publishing status, intended client and approved redirect rather than assuming an old connection authorizes a new one. Never copy a client secret into an issue, public terminal, repository or screenshot.

Publishing an external app and authorizing a mailbox are different actions. A managed Azure identity is not a Google mailbox grant. The direct-API project documents the resulting token and account checks; no live consent is requested by these local examples.
