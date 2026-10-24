#!/usr/bin/env node
import { startHttpServer } from "./http.js";
import { loadConfig } from "./config.js";

const cfg = loadConfig();
if (process.argv.includes("--stdio")) {
  // Local stdio transport (one client, this process). Logs go to stderr so stdout stays pure JSON-RPC.
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { createMcpServer } = await import("./server.js");
  console.log = (...a: unknown[]) => console.error(...a);
  await createMcpServer(cfg).connect(new StdioServerTransport());
} else {
  startHttpServer(cfg);
}
