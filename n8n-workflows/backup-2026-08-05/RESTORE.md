# n8n Workflow Backup — 2026-08-05

Pre-change snapshot of the four live workflows targeted by the blueprint update,
captured **before** any edits so we can revert.

## Two ways to revert

### 1. n8n built-in version history (authoritative, fastest)
Each workflow's live state at capture time is pinned by the `versionId` below.
Restore via the n8n MCP `restore_workflow_version` tool (or the n8n UI → workflow
→ version history → restore that version).

| Workflow | Workflow ID | versionId to restore |
|---|---|---|
| Category Request Handler | `zyLl5wt2UHZ7Deki` | `9b509a50-f4e3-470f-8d97-d995d5ee4441` |
| Excel Requirement Intake | `eXGO9tGgutIxneYS` | `cb49b559-4e8a-4a13-8297-fab16a924fa6` |
| Excel Offer Ingestion — Akay | `j1NAhQEKz9hzi1T2` | `5b4a4ea6-19a9-4b93-a3a5-def1d2b57ac6` |
| Email Body Offer Ingestion — Akay | `8oPUD8d9NPVBEime` | `f09443e1-f653-4d8d-8417-b1f58a934f92` |

### 2. Re-import the JSON snapshots in this folder
The `.json` files here are full exports of each workflow's nodes, connections and
settings as of capture time. They can be re-imported into n8n if version history
is unavailable.

| File | Workflow |
|---|---|
| `category-request-handler.zyLl5wt2UHZ7Deki.json` | Category Request Handler |
| `excel-requirement-intake.eXGO9tGgutIxneYS.json` | Excel Requirement Intake |
| `excel-offer-ingestion.j1NAhQEKz9hzi1T2.json` | Excel Offer Ingestion — Akay |
| `email-body-offer-ingestion.8oPUD8d9NPVBEime.json` | Email Body Offer Ingestion — Akay |

> The two large ingestion files are exact `jq`-extracted exports from the live API.
> The two smaller files are hand-serialized from the live API response and carry a
> `_backupMeta` block (strip it before re-import if your importer is strict).
