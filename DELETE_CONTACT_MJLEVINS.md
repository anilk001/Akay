# Delete Contact: mjlevins@gapamericas.com

## Task
Delete the contact record for `mjlevins@gapamericas.com` from the Airtable contacts database.

## Status
**Cannot complete in this environment**: The Airtable API is not accessible due to network egress restrictions in the remote execution environment.

## How to Complete This Task

### Option 1: Manual Deletion via Airtable UI
1. Go to your Airtable workspace at https://airtable.com
2. Open the Contacts base
3. Find the record with email `mjlevins@gapamericas.com`
4. Delete the record (right-click or select and press Delete)

### Option 2: API Call (from your local machine or an environment with network access)

Use the following curl command to delete the contact record:

```bash
# First, find the record ID
AIRTABLE_TOKEN="your-pat-token-here"
BASE_ID="your-base-id"
TABLE_NAME="Contacts"

# Search for the record
curl -H "Authorization: Bearer $AIRTABLE_TOKEN" \
  "https://api.airtable.com/v0/$BASE_ID/$TABLE_NAME?filterByFormula={Email}='mjlevins@gapamericas.com'"

# Then delete by record ID (once you have it)
RECORD_ID="recXXXXXXXXXXXXXX"
curl -X DELETE \
  -H "Authorization: Bearer $AIRTABLE_TOKEN" \
  "https://api.airtable.com/v0/$BASE_ID/$TABLE_NAME/$RECORD_ID"
```

### Option 3: Using the Airtable MCP Server (requires network access)

Once network access is configured, run:

```javascript
// Find the contacts base
const bases = await mcp.airtable.search_bases({ query: "Contacts" });
const baseId = bases[0].id;

// List tables to find Contacts table
const tables = await mcp.airtable.list_tables_for_base({ baseId });

// Search for the record
const records = await mcp.airtable.search_records({
  baseId,
  tableId: contactsTableId,
  query: "mjlevins@gapamericas.com"
});

// Delete the record
if (records.length > 0) {
  await mcp.airtable.delete_records({
    baseId,
    tableId: contactsTableId,
    recordIds: [records[0].id]
  });
}
```

## Environment Configuration Needed

To enable Airtable API access in this remote session, add the following to your network settings:
- **Host**: `api.airtable.com`
- **Purpose**: Contact management

## Branch
This work is being tracked on branch: `claude/delete-mjlevins-contacts-ires31`

## Next Steps
1. Once network access is configured, use Option 3 above to automate the deletion
2. Commit any resulting changes to this branch
3. Push to remote and create a PR if needed
