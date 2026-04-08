#!/usr/bin/env node

/**
 * HTTP Server Entry Point voor Docker-deployment
 *
 * Biedt Streamable HTTP transport voor externe MCP clients.
 * Gebruik src/index.ts voor lokaal stdio-gebruik.
 *
 * Endpoints:
 *   GET  /health  — liveness probe
 *   POST /mcp     — MCP Streamable HTTP (sessie-bewust)
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  listSourcebooks,
  searchProvisions,
  getProvision,
  searchEnforcement,
  checkProvisionCurrency,
} from "./db.js";
import { buildCitation } from "./citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const SERVER_NAME = "dutch-financial-regulation-mcp";

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback
}

// Tool definitions (gedeeld met index.ts)

const TOOLS = [
  {
    name: "nl_fin_search_regulations",
    description:
      "Volledige-tekstzoekfunctie in AFM- en DNB-regelgeving. Geeft overeenkomende bepalingen, leidraden, beleidsregels en toezichtregelingen terug.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Zoekterm" },
        sourcebook: { type: "string", description: "Filter op brondocument-ID. Optioneel." },
        status: {
          type: "string",
          enum: ["van_kracht", "ingetrokken", "nog_niet_van_kracht"],
          description: "Filter op status. Optioneel.",
        },
        limit: { type: "number", description: "Max resultaten (standaard 20)." },
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
        sourcebook: { type: "string", description: "Brondocument-ID (bijv. AFM-LEIDRAAD, DNB-TOEZICHT)" },
        reference: { type: "string", description: "Bepalingsreferentie (bijv. 'Wwft 2.1')" },
      },
      required: ["sourcebook", "reference"],
    },
  },
  {
    name: "nl_fin_list_sourcebooks",
    description: "Geef een lijst van alle beschikbare brondocumenten.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "nl_fin_search_enforcement",
    description:
      "Zoek in AFM- en DNB-handhavingsbesluiten — boetes, aanwijzingen en dwangsommen.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Zoekterm (naam instelling, type overtreding, etc.)" },
        action_type: {
          type: "string",
          enum: ["boete", "aanwijzing", "dwangsom", "last_onder_dwangsom"],
          description: "Filter op type handhavingsactie. Optioneel.",
        },
        limit: { type: "number", description: "Max resultaten (standaard 20)." },
      },
      required: ["query"],
    },
  },
  {
    name: "nl_fin_check_currency",
    description: "Controleer of een regelgevingsreferentie momenteel van kracht is.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: { type: "string", description: "Referentie om te controleren" },
      },
      required: ["reference"],
    },
  },
  {
    name: "nl_fin_about",
    description: "Geef metadata over deze MCP server: versie, databron, lijst met tools.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
];

// Zod schemas

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

// MCP server factory

function createMcpServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: pkgVersion },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    function textContent(data: unknown) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }

    function errorContent(message: string) {
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true as const,
      };
    }

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
          return textContent({ results, count: results.length });
        }

        case "nl_fin_get_regulation": {
          const parsed = GetRegulationArgs.parse(args);
          const provision = getProvision(parsed.sourcebook, parsed.reference);
          if (!provision) {
            return errorContent(
              `Bepaling niet gevonden: ${parsed.sourcebook} ${parsed.reference}`,
            );
          }
          const prov = provision as Record<string, unknown>;
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
          return textContent({ sourcebooks, count: sourcebooks.length });
        }

        case "nl_fin_search_enforcement": {
          const parsed = SearchEnforcementArgs.parse(args);
          const results = searchEnforcement({
            query: parsed.query,
            action_type: parsed.action_type,
            limit: parsed.limit,
          });
          return textContent({ results, count: results.length });
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

  return server;
}

// HTTP server

async function main(): Promise<void> {
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: Server }
  >();

  const httpServer = createServer((req, res) => {
    handleRequest(req, res, sessions).catch((err) => {
      console.error(`[${SERVER_NAME}] Onverwerkte fout:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Interne serverfout" }));
      }
    });
  });

  async function handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    activeSessions: Map<
      string,
      { transport: StreamableHTTPServerTransport; server: Server }
    >,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: SERVER_NAME, version: pkgVersion }));
      return;
    }

    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        return;
      }

      // Nieuwe sessie — maak per sessie een nieuw MCP server-exemplaar
      const mcpServer = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK type mismatch with exactOptionalPropertyTypes
      await mcpServer.connect(transport as any);

      transport.onclose = () => {
        if (transport.sessionId) {
          activeSessions.delete(transport.sessionId);
        }
        mcpServer.close().catch(() => {});
      };

      await transport.handleRequest(req, res);

      // Opslaan NA handleRequest — sessionId wordt ingesteld tijdens initialize
      if (transport.sessionId) {
        activeSessions.set(transport.sessionId, { transport, server: mcpServer });
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Niet gevonden" }));
  }

  httpServer.listen(PORT, () => {
    console.error(`${SERVER_NAME} v${pkgVersion} (HTTP) luistert op poort ${PORT}`);
    console.error(`MCP endpoint:  http://localhost:${PORT}/mcp`);
    console.error(`Health check:  http://localhost:${PORT}/health`);
  });

  process.on("SIGTERM", () => {
    console.error("SIGTERM ontvangen, server wordt afgesloten...");
    httpServer.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("Fatale fout:", err);
  process.exit(1);
});
