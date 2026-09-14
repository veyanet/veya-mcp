import express, { type Request, type Response } from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  loadConfig,
  writesEnabled,
  MCP_SERVICE_NAME,
  MCP_SERVICE_VERSION,
  type McpServiceConfig,
} from "./config.js";
import { extractBearer } from "./auth.js";
import { createMcpServer, requestAuth } from "./server.js";
import { renderLandingHtml } from "./landingPage.js";

export function createHttpApp(cfg: McpServiceConfig = loadConfig()) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (cfg.corsOrigins.length === 0) return cb(null, false);
        if (cfg.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    }),
  );

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      service: MCP_SERVICE_NAME,
      version: MCP_SERVICE_VERSION,
      publicMcpUrl: cfg.publicMcpUrl,
      chainId: cfg.chainId,
      contractAddress: cfg.contractAddress,
      writesEnabled: writesEnabled(cfg),
      sealed: "AES-256-GCM (not FHE)",
      settlement: "Robinhood Chain testnet 46630",
    });
  });

  // Stateless Streamable HTTP — paste URL into Claude / Cursor (POST /mcp)
  app.post("/mcp", async (req: Request, res: Response) => {
    const bearer = extractBearer(req);
    await requestAuth.run({ bearer }, async () => {
      try {
        const server = createMcpServer(cfg);
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on("close", () => {
          void transport.close();
          void server.close();
        });
      } catch (err) {
        console.error("[veyanet/mcp] POST /mcp", err);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });
  });

  // Optional stateful path for clients that send MCP-Session-Id
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  app.post("/mcp/session", async (req: Request, res: Response) => {
    const bearer = extractBearer(req);
    await requestAuth.run({ bearer }, async () => {
      try {
        const sessionId = req.header("mcp-session-id") || undefined;
        if (sessionId && sessions.has(sessionId)) {
          await sessions.get(sessionId)!.handleRequest(req, res, req.body);
          return;
        }
        if (!sessionId && isInitializeRequest(req.body)) {
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id) => {
              sessions.set(id, transport);
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) sessions.delete(transport.sessionId);
          };
          const server = createMcpServer(cfg);
          await server.connect(transport);
          await transport.handleRequest(req, res, req.body);
          return;
        }
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "No valid MCP session" },
          id: null,
        });
      } catch (err) {
        console.error("[veyanet/mcp] POST /mcp/session", err);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          });
        }
      }
    });
  });

  app.get("/", (_req, res) => {
    res.type("html").send(renderLandingHtml(cfg));
  });

  return app;
}

export function startHttpServer(cfg: McpServiceConfig = loadConfig()) {
  const app = createHttpApp(cfg);
  return app.listen(cfg.port, cfg.host, () => {
    console.log(`[veyanet/mcp] listening on http://${cfg.host}:${cfg.port}`);
    console.log(`[veyanet/mcp] MCP POST ${cfg.publicMcpUrl} (local /mcp)`);
    console.log(`[veyanet/mcp] writesEnabled=${writesEnabled(cfg)}`);
  });
}
