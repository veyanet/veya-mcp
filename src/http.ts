import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { extractBearer } from "./auth.js";
import {
  loadConfig,
  operatorRelayerWritesEnabled,
  MCP_SERVICE_NAME,
  MCP_SERVICE_VERSION,
  type McpServiceConfig,
} from "./config.js";
import { createMcpServer } from "./server.js";
import { registeredToolCount, renderMcpInfoHtml, renderMcpRootHtml, wantsHtml } from "./mcpInfoPage.js";
import { LOGO_PNG, LOGO_MARK_LIGHT_PNG } from "./brandAssets.js";

export function createHttpApp(cfg: McpServiceConfig = loadConfig()): Express {
  const app = express();
  app.set("trust proxy", 1);
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

  const healthHandler = (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: MCP_SERVICE_NAME,
      version: MCP_SERVICE_VERSION,
      publicMcpUrl: cfg.publicMcpUrl,
      network: cfg.network,
      chainId: cfg.chainId,
      contractAddress: cfg.contractAddress,
      writesEnabled: true,
      operatorRelayerWrites: operatorRelayerWritesEnabled(cfg),
      sealed: "AES-256-GCM",
      settlement: cfg.network === "mainnet"
        ? "Robinhood Chain mainnet"
        : "Robinhood Chain testnet",
    });
  };
  app.get("/health", healthHandler);
  app.get("/healthz", healthHandler);
  app.get("/assets/veya-logo.png", (_req, res) => {
    res.set("Cache-Control", "public, max-age=86400").type("png").send(LOGO_PNG);
  });
  app.get("/assets/veya-logo-light.png", (_req, res) => {
    res.set("Cache-Control", "public, max-age=86400").type("png").send(LOGO_MARK_LIGHT_PNG);
  });

  // Browser visit to /mcp gets a setup page. MCP clients (POST, or GET with text/event-stream) are untouched.
  app.get("/mcp", (req, res, next) => {
    if (!wantsHtml(req.header("accept"))) return next();
    res.type("html").send(renderMcpInfoHtml(cfg, registeredToolCount(cfg)));
  });

  // Stateless Streamable HTTP. Cursor also opens GET /mcp for the event stream.
  const handleMcp = async (req: Request, res: Response) => {
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
      const name = err instanceof Error ? err.name : "Error";
      console.error(`[veyanet/mcp] ${req.method} /mcp ${name} ${res.statusCode || 500}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  };
  const mcpLimiter = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const requireOperatorKey = (req: Request, res: Response, next: NextFunction) => {
    if (!cfg.mcpApiKey) return next();
    const presented = extractBearer(req);
    const expected = Buffer.from(cfg.mcpApiKey);
    const got = Buffer.from(presented ?? "");
    if (!presented || got.length !== expected.length || !timingSafeEqual(got, expected)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
  app.use("/mcp", mcpLimiter, requireOperatorKey);

  app.post("/mcp", handleMcp);
  app.get("/mcp", handleMcp);
  app.delete("/mcp", handleMcp);

  // Optional stateful path for clients that send MCP-Session-Id
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; lastSeen: number }>();
  const sessionIdleMs = 30 * 60 * 1000;
  const sessionCap = 1000;
  const sweepSessions = () => {
    const now = Date.now();
    for (const [id, row] of sessions) {
      if (now - row.lastSeen > sessionIdleMs) {
        void row.transport.close();
        sessions.delete(id);
      }
    }
  };
  const sweepTimer = setInterval(sweepSessions, 60_000);
  sweepTimer.unref();

  app.post("/mcp/session", async (req: Request, res: Response) => {
    try {
      sweepSessions();
      const sessionId = req.header("mcp-session-id") || undefined;
      const existing = sessionId ? sessions.get(sessionId) : undefined;
      if (existing) {
        existing.lastSeen = Date.now();
        await existing.transport.handleRequest(req, res, req.body);
        return;
      }
      if (!sessionId && isInitializeRequest(req.body)) {
        if (sessions.size >= sessionCap) {
          const oldest = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
          if (oldest) {
            void oldest[1].transport.close();
            sessions.delete(oldest[0]);
          }
        }
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport, lastSeen: Date.now() });
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
      const name = err instanceof Error ? err.name : "Error";
      console.error(`[veyanet/mcp] POST /mcp/session ${name} ${res.statusCode || 500}`);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/", (_req, res) => {
    res.type("html").send(renderMcpRootHtml(cfg, registeredToolCount(cfg)));
  });

  return app;
}

export function startHttpServer(cfg: McpServiceConfig = loadConfig()) {
  const app = createHttpApp(cfg);
  return app.listen(cfg.port, cfg.host, () => {
    console.log(`[veyanet/mcp] listening on http://${cfg.host}:${cfg.port}`);
    console.log(`[veyanet/mcp] MCP POST ${cfg.publicMcpUrl} (local /mcp)`);
    console.log(`[veyanet/mcp] userPaidWrites=true operatorRelayerWrites=${operatorRelayerWritesEnabled(cfg)}`);
  });
}
