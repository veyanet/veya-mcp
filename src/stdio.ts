#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./server.js";

// stdout carries MCP JSON-RPC only; send any log output to stderr.
console.log = console.error;
console.info = console.error;

const server = createMcpServer(loadConfig());
await server.connect(new StdioServerTransport());
console.error("[veyanet/mcp] stdio transport ready");
