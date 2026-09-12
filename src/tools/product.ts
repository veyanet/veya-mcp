import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServiceConfig } from "../config.js";
import { apiRequest, toolError, toolJson } from "../api.js";

const sessionToken = z
  .string()
  .min(10)
  .optional()
  .describe("Product API JWT from guest or wallet login. Build writes return 403 for guests.");

export function registerProductTools(server: McpServer, cfg: McpServiceConfig): void {
  server.tool(
    "veya_guest_login",
    "Create a guest session on the product API (Use-only). Requires API relayer configured on the API host.",
    {},
    async () => {
      try {
        return toolJson(await apiRequest(cfg, "/auth/guest", { method: "POST" }));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_list_environments",
    "List environments for a session (guest sees showcase / Use scope)",
    { sessionToken },
    async ({ sessionToken: token }) => {
      try {
        if (!token) {
          return toolJson({
            error: "sessionToken required",
            hint: "Call veya_guest_login first, or pass a wallet JWT",
          });
        }
        return toolJson(await apiRequest(cfg, "/v1/environments", { sessionToken: token }));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_get_environment",
    "Get one environment by id",
    { sessionToken, environmentId: z.string().min(1) },
    async ({ sessionToken: token, environmentId }) => {
      try {
        if (!token) return toolJson({ error: "sessionToken required" });
        return toolJson(
          await apiRequest(cfg, `/v1/environments/${encodeURIComponent(environmentId)}`, {
            sessionToken: token,
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_create_environment",
    "Create environment (Build). Guests receive 403 by design.",
    {
      sessionToken,
      name: z.string().min(1),
      type: z.enum(["research", "governance", "treasury", "contributor", "protocol", "desci"]),
    },
    async ({ sessionToken: token, name, type }) => {
      try {
        if (!token) return toolJson({ error: "sessionToken required" });
        return toolJson(
          await apiRequest(cfg, "/v1/environments", {
            method: "POST",
            sessionToken: token,
            body: { name, type },
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_list_agents",
    "List agents in an environment",
    { sessionToken, environmentId: z.string().min(1) },
    async ({ sessionToken: token, environmentId }) => {
      try {
        if (!token) return toolJson({ error: "sessionToken required" });
        return toolJson(
          await apiRequest(cfg, `/v1/environments/${encodeURIComponent(environmentId)}/agents`, {
            sessionToken: token,
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_deploy_agent",
    "Deploy an agent (Build). Guests receive 403 by design.",
    {
      sessionToken,
      environmentId: z.string().min(1),
      type: z.string().min(1),
      permissionConfig: z.record(z.unknown()).optional(),
    },
    async ({ sessionToken: token, environmentId, type, permissionConfig }) => {
      try {
        if (!token) return toolJson({ error: "sessionToken required" });
        return toolJson(
          await apiRequest(cfg, `/v1/environments/${encodeURIComponent(environmentId)}/agents`, {
            method: "POST",
            sessionToken: token,
            body: { type, permissionConfig },
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_list_api_memory",
    "List memory entries via product API for an environment",
    {
      sessionToken,
      environmentId: z.string().min(1),
      scope: z.enum(["environment", "agent", "session"]).optional(),
    },
    async ({ sessionToken: token, environmentId, scope }) => {
      try {
        if (!token) return toolJson({ error: "sessionToken required" });
        const q = scope ? `?scope=${scope}` : "";
        return toolJson(
          await apiRequest(
            cfg,
            `/v1/environments/${encodeURIComponent(environmentId)}/memory${q}`,
            { sessionToken: token },
          ),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_list_executions",
    "List executions for an environment via product API",
    { sessionToken, environmentId: z.string().min(1) },
    async ({ sessionToken: token, environmentId }) => {
      try {
        if (!token) return toolJson({ error: "sessionToken required" });
        return toolJson(
          await apiRequest(
            cfg,
            `/v1/environments/${encodeURIComponent(environmentId)}/executions`,
            { sessionToken: token },
          ),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_run_protected_execution",
    "Run protected execution via product API (Build). Guests receive 403 by design.",
    {
      sessionToken,
      environmentId: z.string().min(1),
      agentId: z.string().min(1),
      eventType: z.string().min(1),
      payload: z.record(z.unknown()),
      disclose: z.array(z.string()).optional(),
      seal: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        if (!args.sessionToken) return toolJson({ error: "sessionToken required" });
        return toolJson(
          await apiRequest(
            cfg,
            `/v1/environments/${encodeURIComponent(args.environmentId)}/executions/protected`,
            {
              method: "POST",
              sessionToken: args.sessionToken,
              body: {
                agentId: args.agentId,
                eventType: args.eventType,
                payload: args.payload,
                disclose: args.disclose,
                seal: args.seal,
              },
            },
          ),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_boundnet_invoke",
    "Invoke a Boundnet / coordination tool via product API (policy gated)",
    {
      sessionToken,
      environmentId: z.string().min(1),
      agentId: z.string().min(1),
      toolName: z.string().min(1),
      arguments: z.record(z.unknown()).optional(),
    },
    async (args) => {
      try {
        if (!args.sessionToken) return toolJson({ error: "sessionToken required" });
        return toolJson(
          await apiRequest(
            cfg,
            `/v1/environments/${encodeURIComponent(args.environmentId)}/boundnet/invoke`,
            {
              method: "POST",
              sessionToken: args.sessionToken,
              body: {
                agentId: args.agentId,
                toolName: args.toolName,
                arguments: args.arguments,
              },
            },
          ),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_list_proofs",
    "List Use-mode proof anchors for the session",
    { sessionToken },
    async ({ sessionToken: token }) => {
      try {
        if (!token) return toolJson({ error: "sessionToken required" });
        return toolJson(await apiRequest(cfg, "/v1/proofs", { sessionToken: token }));
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_anchor_proof",
    "Anchor a content proof via product API (guest Use path when API allows)",
    {
      sessionToken,
      label: z.string().min(1),
      content: z.string().min(1),
    },
    async ({ sessionToken: token, label, content }) => {
      try {
        if (!token) return toolJson({ error: "sessionToken required" });
        return toolJson(
          await apiRequest(cfg, "/v1/proofs/anchor", {
            method: "POST",
            sessionToken: token,
            body: { label, content },
          }),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "veya_verify_proof_api",
    "Verify an anchored proof via product API public verify path",
    { signature: z.string().min(1) },
    async ({ signature }) => {
      try {
        return toolJson(
          await apiRequest(cfg, `/api/verify/${encodeURIComponent(signature)}`),
        );
      } catch (err) {
        return toolError(err);
      }
    },
  );
}
