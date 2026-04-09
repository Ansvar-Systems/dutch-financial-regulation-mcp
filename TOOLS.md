# Tools

All tools exposed by the Dutch Financial Regulation MCP server. Tool prefix: `nl_fin_`.

## Tool List

### `nl_fin_search_regulations`

Full-text search across AFM and DNB regulations.

**Inputs:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search term (e.g. `witwassen`, `informatieverstrekking`) |
| `sourcebook` | string | No | Filter by sourcebook ID (e.g. `AFM-LEIDRAAD`) |
| `status` | enum | No | `van_kracht` \| `ingetrokken` \| `nog_niet_van_kracht` |
| `limit` | number | No | Max results (default 20, max 100) |

**Returns:** `{ results: Provision[], count: number }`

---

### `nl_fin_get_regulation`

Retrieve a specific provision by sourcebook and reference. Response includes a `_citation` metadata block for deterministic entity linking.

**Inputs:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourcebook` | string | Yes | Sourcebook ID (e.g. `AFM-LEIDRAAD`, `DNB-TOEZICHT`) |
| `reference` | string | Yes | Provision reference (e.g. `Wwft 2.1`) |

**Returns:** `Provision & { _citation: CitationMetadata }`

---

### `nl_fin_list_sourcebooks`

List all available sourcebooks with names and descriptions.

**Inputs:** _(none)_

**Returns:** `{ sourcebooks: Sourcebook[], count: number }`

---

### `nl_fin_search_enforcement`

Search AFM and DNB enforcement decisions — fines, instructions, and penalty payments.

**Inputs:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search term (institution name, violation type, etc.) |
| `action_type` | enum | No | `boete` \| `aanwijzing` \| `dwangsom` \| `last_onder_dwangsom` |
| `limit` | number | No | Max results (default 20, max 100) |

**Returns:** `{ results: EnforcementAction[], count: number }`

---

### `nl_fin_check_currency`

Check whether a specific regulatory reference is currently in force.

**Inputs:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reference` | string | Yes | Reference to check (e.g. `Wwft 2.1`) |

**Returns:** `{ reference: string, status: string, effective_date: string | null }`

---

### `nl_fin_about`

Return metadata about this MCP server: version, data sources, tool list.

**Inputs:** _(none)_

**Returns:** Server metadata object including version, description, data_sources, and tool list.

---

## Notes

- All tools use Dutch-language field names matching official regulatory terminology.
- `_citation` on `nl_fin_get_regulation` follows the fleet-wide citation schema (`canonical_ref`, `display_text`, `source_url`, `lookup`).
- Status values use Dutch terms: `van_kracht` (in force), `ingetrokken` (withdrawn), `nog_niet_van_kracht` (not yet in force).
