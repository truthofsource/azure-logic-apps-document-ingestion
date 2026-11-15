# Source and Public Adaptations

Actual source files are copied or extracted from the implemented workforce platform. [The source map](source-map.json) records original SHA-256 values before adaptations. Organization, provider, resource and role labels are fictionalized; source paths use those public labels too. No private Git history or message data is included.

Relative TypeScript imports use explicit extensions for Node execution. Filename-normalization variable names are made consistent in copied code. These selected files run without installing the full application.

The document project extracts the pure planner and removes its HTTP response/authentication/registration wrappers. Its Terraform retains the actual steady actions while replacing surrounding environment bindings with explicit example inputs. App-role grants, connector creation, database and scanner deployment are omitted; they remain required dependencies. The replacement workflow's fixed-query correction is not described as a completed live handover.

The Gmail access project retains the current CommonJS mailbox helpers. Two original prototype tests are adapted to import those runtime helpers. Its transport constructor uses an explicit field assignment instead of a TypeScript parameter property so Node's built-in type stripping can execute it. Additional focused tests use fake HTTP responses and fictional internal evidence. The full raw-message verifier, Key Vault lookup and SQL claims remain reference code with omitted dependencies.

The connector-history module is actual retained Terraform for the failed approach. It defaults Off and does not represent the direct runtime's infrastructure dependency. Changing a provider-specific name/domain to an example also means these public copies are not deployable against the original provider unchanged.
