# Coverage

Data coverage for the Dutch Financial Regulation MCP server.

## Status: Partial

This server ingests data from four official Dutch regulatory sourcebooks. Coverage is partial — not every provision from each sourcebook may be present in the database. Verify critical references against primary sources.

## Sourcebooks

| ID | Name | Publisher | Status | Notes |
|----|------|-----------|--------|-------|
| `AFM-LEIDRAAD` | AFM Leidraden | Autoriteit Financiële Markten | Partial | Selected guidance documents ingested |
| `AFM-BELEIDSREGEL` | AFM Beleidsregels | Autoriteit Financiële Markten | Partial | Selected policy rules ingested |
| `DNB-TOEZICHT` | DNB Toezichtregelingen | De Nederlandsche Bank | Partial | Selected supervisory regulations ingested |
| `DNB-GOODPRACTICE` | DNB Good Practices | De Nederlandsche Bank | Partial | Selected good practice documents ingested |

## Primary Sources

- AFM publications: <https://www.afm.nl/nl-nl/professionals/onderwerpen/leidraden>
- AFM beleidsregels: <https://www.afm.nl/nl-nl/professionals/onderwerpen/beleidsregels>
- DNB toezicht: <https://www.dnb.nl/toezicht/>
- DNB good practices: <https://www.dnb.nl/toezicht/good-practices/>

## Data Licensing

Regulatory data is sourced from official Dutch government publications (AFM and DNB). These are public authority documents. Consult each publisher's terms for redistribution conditions.

## Freshness

Database updates are performed periodically via `npm run ingest`. Tool responses include `effective_date` and `status` fields to indicate provision currency. Always verify against primary sources for compliance decisions.

## Coverage Gaps

- Not all leidraden editions are ingested
- Older/withdrawn provisions may be incomplete
- Enforcement actions database covers a selected time window

See `data/coverage.json` for machine-readable coverage summary.
