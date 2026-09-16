#!/usr/bin/env node
/**
 * nfl-market-mcp-server
 *
 * Remote MCP server (streamable HTTP, stateless JSON) exposing NFL market data from keyless public
 * sources: Kalshi's public market-data API (game, spread and total ladders, player props, price
 * history, results), DraftKings game and prop lines from ESPN's public feeds, and National Weather
 * Service stadium forecasts. Connector for the NF Agent, built on the same pattern as the
 * Parcel-GIS, FEMA and Municode connectors.
 *
 * Deploy target: Render web service (GitHub auto-deploy). No API keys.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { registerTools, TOOL_NAMES } from "./tools.js";

const VERSION = "2.0.0";

function buildServer(): McpServer {
  const server = new McpServer({ name: "nfl-market-mcp-server", version: VERSION });
  registerTools(server);
  return server;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

// Health check for Render + humans.
app.get("/", (_req, res) => {
  res.json({ name: "nfl-market-mcp-server", version: VERSION, status: "ok", mcp_endpoint: "/mcp", api_keys: "none", tools: TOOL_NAMES });
});

// Stateless streamable HTTP: fresh transport + server per request, JSON responses.
app.post("/mcp", async (req, res) => {
  try {
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// Reject non-POST on /mcp cleanly (stateless server: no GET stream, no sessions).
app.get("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. POST JSON-RPC to /mcp." }, id: null });
});

const port = parseInt(process.env.PORT || "3000", 10);
app.listen(port, () => {
  console.error(`nfl-market-mcp-server ${VERSION} listening on port ${port} (MCP endpoint: POST /mcp)`);
});
