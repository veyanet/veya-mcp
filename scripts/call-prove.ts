/**
 * In-process call of veya_prove against the live RPC.
 * Anchor is called with no payer key and must refuse.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";

const txHash = process.argv[2];
if (!txHash) {
  console.error("usage: tsx scripts/call-prove.ts <txHash>");
  process.exit(1);
}

const cfg = loadConfig();
cfg.payerPrivateKey = null;
cfg.relayerPrivateKey = null;

const server = createMcpServer(cfg);
const client = new Client({ name: "proof-check", version: "0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);

const verified = await client.callTool({ name: "veya_prove", arguments: { txHash } });
const refused = await client.callTool({
  name: "veya_prove",
  arguments: { text: "no-payer", anchor: true },
});

console.log("VERIFIED");
console.log(JSON.stringify(verified, null, 2));
console.log("REFUSED");
console.log(JSON.stringify(refused, null, 2));

const verifiedText = textOf(verified);
const refusedText = textOf(refused);
const verifiedJson = JSON.parse(verifiedText);
const refusedJson = JSON.parse(refusedText);
if (verifiedJson.ok !== true || verifiedJson.chainId !== 46630 || !verifiedJson.explorerUrl) {
  process.exit(1);
}
if (refused.isError !== true || refusedJson.ok !== false || refusedJson.anchored !== false) {
  process.exit(1);
}

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  const block = result.content?.find((item) => item.type === "text");
  if (!block?.text) throw new Error("tool returned no text");
  return block.text;
}
