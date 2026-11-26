import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { parseArgs } from "../lib/args.js";
import { resolveServer } from "../lib/client.js";
import { createMediaMcpServer } from "../lib/mcpServer.js";

const HELP = `ima2 mcp [--server URL]
ima2 mcp tools [--server URL] [--json]
Serve media tools over MCP stdio, or list their descriptors.
Claude Code: {"mcpServers":{"ima2":{"command":"ima2","args":["mcp"]}}}
Codex: codex mcp add ima2 -- ima2 mcp`;

async function serve(server: ReturnType<typeof createMediaMcpServer>, controller: AbortController): Promise<void> {
  const transport = new StdioServerTransport();
  let finish!: () => void;
  const ended = new Promise<void>((resolve) => { finish = resolve; });
  process.stdin.once("end", finish);
  process.stdin.once("close", finish);
  server.onclose = finish;
  try {
    await server.connect(transport);
    if (process.stdin.readableEnded || process.stdin.destroyed) finish();
    await ended;
  } finally {
    controller.abort();
    process.stdin.removeListener("end", finish);
    process.stdin.removeListener("close", finish);
    await server.close();
  }
}
async function list(server: ReturnType<typeof createMediaMcpServer>, json: boolean): Promise<void> {
  const client = new Client({ name: "ima2-mcp-tools", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.listTools();
    console.log(json ? JSON.stringify(result, null, 2) : result.tools.map((tool) => `${tool.name}\t${tool.description ?? ""}`).join("\n"));
  } finally { await client.close(); await server.close(); }
}
export default async function mcpCmd(argv: string[], version = "?"): Promise<void> {
  if (argv.includes("--help") || argv.includes("-h")) { console.log(HELP); return; }
  try {
    const args = parseArgs(argv, { flags: { server: { type: "string" }, json: { type: "boolean" } } });
    if (args._unknown.length || args.positional.length > 1 || (args.positional[0] && args.positional[0] !== "tools") || (args.json && !args.positional[0])) {
      throw new Error("Invalid arguments; run ima2 mcp --help");
    }
    const controller = new AbortController();
    const server = createMediaMcpServer({ resolveBase: async () => (await resolveServer({ serverFlag: args.server })).base,
      version, log: (message) => console.error(message), signal: controller.signal });
    if (args.positional[0] === "tools") await list(server, Boolean(args.json));
    else await serve(server, controller);
  } catch (error) {
    console.error(`ima2 mcp: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
