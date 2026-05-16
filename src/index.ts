#!/usr/bin/env node

/**
 * Nederlandse Financiële Regelgeving MCP — stdio entry point.
 *
 * Biedt MCP tools voor het bevragen van AFM- en DNB-regelgeving: bepalingen,
 * brondocumenten, handhavingsacties en valutacontroles.
 *
 * Tool prefix: nl_fin_
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  listSourcebooks,
  searchProvisions,
  getProvision,
  searchEnforcement,
  checkProvisionCurrency,
} from "./db.js";
import { buildCitation, buildItemAttribution } from "./citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback naar standaard
}

const SERVER_NAME = "dutch-financial-regulation-mcp";

// Tool definitions

const TOOLS = [
  {
    name: "nl_fin_search_regulations",
    description:
      "Volledige-tekstzoekfunctie in AFM- en DNB-regelgeving. Geeft overeenkomende bepalingen, leidraden, beleidsregels en toezichtregelingen terug.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Zoekterm (bijv. 'witwassen', 'informatieverstrekking', 'geschiktheid')",
        },
        sourcebook: {
          type: "string",
          description: "Filter op brondocument-ID (bijv. AFM-LEIDRAAD, DNB-TOEZICHT). Optioneel.",
        },
        status: {
          type: "string",
          enum: ["van_kracht", "ingetrokken", "nog_niet_van_kracht"],
          description: "Filter op status van de bepaling. Standaard alle statussen.",
        },
        limit: {
          type: "number",
          description: "Maximum aantal resultaten. Standaard 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "nl_fin_get_regulation",
    description:
      "Haal een specifieke AFM- of DNB-bepaling op via brondocument en referentie.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sourcebook: {
          type: "string",
          description: "Brondocument-ID (bijv. AFM-LEIDRAAD, AFM-BELEIDSREGEL, DNB-TOEZICHT, DNB-GOODPRACTICE)",
        },
        reference: {
          type: "string",
          description: "Volledige referentie (bijv. 'Wwft 2.1', 'Informatieverstrekking 3.2')",
        },
      },
      required: ["sourcebook", "reference"],
    },
  },
  {
    name: "nl_fin_list_sourcebooks",
    description:
      "Geef een lijst van alle beschikbare brondocumenten met namen en beschrijvingen.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "nl_fin_search_enforcement",
    description:
      "Zoek in AFM- en DNB-handhavingsbesluiten — boetes, aanwijzingen en dwangsommen. Geeft overeenkomende handhavingsacties terug.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Zoekterm (bijv. naam instelling, type overtreding, 'witwassen')",
        },
        action_type: {
          type: "string",
          enum: ["boete", "aanwijzing", "dwangsom", "last_onder_dwangsom"],
          description: "Filter op type handhavingsactie. Optioneel.",
        },
        limit: {
          type: "number",
          description: "Maximum aantal resultaten. Standaard 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "nl_fin_check_currency",
    description:
      "Controleer of een specifieke regelgevingsreferentie momenteel van kracht is. Geeft status en ingangsdatum terug.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "Te controleren referentie (bijv. 'Wwft 2.1', 'Informatieverstrekking 3.2')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "nl_fin_about",
    description: "Geef metadata over deze MCP server: versie, databron, lijst met tools.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// Zod schemas voor argumentvalidatie

const SearchRegulationsArgs = z.object({
  query: z.string().min(1),
  sourcebook: z.string().optional(),
  status: z.enum(["van_kracht", "ingetrokken", "nog_niet_van_kracht"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetRegulationArgs = z.object({
  sourcebook: z.string().min(1),
  reference: z.string().min(1),
});

const SearchEnforcementArgs = z.object({
  query: z.string().min(1),
  action_type: z.enum(["boete", "aanwijzing", "dwangsom", "last_onder_dwangsom"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const CheckCurrencyArgs = z.object({
  reference: z.string().min(1),
});

// Helper

function textContent(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

// Server setup

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "nl_fin_search_regulations": {
        const parsed = SearchRegulationsArgs.parse(args);
        const results = searchProvisions({
          query: parsed.query,
          sourcebook: parsed.sourcebook,
          status: parsed.status,
          limit: parsed.limit,
        });
        // Source Attribution Standard: per-item _citation on every served item.
        const resultsWithCitation = results.map((r) => {
          const row = r as unknown as Record<string, unknown>;
          return {
            ...row,
            _citation: buildItemAttribution(
              row["url"] != null ? String(row["url"]) : undefined,
            ),
          };
        });
        return textContent({ results: resultsWithCitation, count: resultsWithCitation.length });
      }

      case "nl_fin_get_regulation": {
        const parsed = GetRegulationArgs.parse(args);
        const provision = getProvision(parsed.sourcebook, parsed.reference);
        if (!provision) {
          return errorContent(
            `Bepaling niet gevonden: ${parsed.sourcebook} ${parsed.reference}`,
          );
        }
        const prov = provision as unknown as Record<string, unknown>;
        return textContent({
          ...prov,
          _citation: buildCitation(
            String(prov.reference ?? parsed.reference),
            String(prov.title ?? prov.reference ?? parsed.reference),
            "nl_fin_get_regulation",
            { sourcebook: parsed.sourcebook, reference: parsed.reference },
            prov.url != null ? String(prov.url) : undefined,
          ),
        });
      }

      case "nl_fin_list_sourcebooks": {
        const sourcebooks = listSourcebooks();
        // Source Attribution Standard: per-item _citation on every served item.
        const sourcebooksWithCitation = sourcebooks.map((s) => {
          const row = s as unknown as Record<string, unknown>;
          return {
            ...row,
            _citation: buildItemAttribution(
              row["url"] != null ? String(row["url"]) : undefined,
            ),
          };
        });
        return textContent({ sourcebooks: sourcebooksWithCitation, count: sourcebooksWithCitation.length });
      }

      case "nl_fin_search_enforcement": {
        const parsed = SearchEnforcementArgs.parse(args);
        const results = searchEnforcement({
          query: parsed.query,
          action_type: parsed.action_type,
          limit: parsed.limit,
        });
        // Source Attribution Standard: per-item _citation on every served item.
        const resultsWithCitation = results.map((r) => {
          const row = r as unknown as Record<string, unknown>;
          return {
            ...row,
            _citation: buildItemAttribution(
              row["url"] != null ? String(row["url"]) : undefined,
            ),
          };
        });
        return textContent({ results: resultsWithCitation, count: resultsWithCitation.length });
      }

      case "nl_fin_check_currency": {
        const parsed = CheckCurrencyArgs.parse(args);
        const currency = checkProvisionCurrency(parsed.reference);
        return textContent(currency);
      }

      case "nl_fin_about": {
        return textContent({
          name: SERVER_NAME,
          version: pkgVersion,
          description:
            "Nederlandse Financiële Regelgeving MCP server. Biedt toegang tot AFM-leidraden, AFM-beleidsregels, DNB-toezichtregelingen, DNB Good Practices en handhavingsacties.",
          data_sources: [
            "AFM Leidraden (https://www.afm.nl/)",
            "AFM Beleidsregels (https://www.afm.nl/)",
            "DNB Toezichtregelingen (https://www.dnb.nl/)",
            "DNB Good Practices (https://www.dnb.nl/)",
          ],
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        });
      }

      default:
        return errorContent(`Onbekende tool: ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`Fout bij uitvoering ${name}: ${message}`);
  }
});

// Main

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} draait op stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatale fout: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
