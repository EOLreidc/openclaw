/**
 * Standalone MCP server that exposes OpenClaw plugin-registered tools
 * (e.g. memory-lancedb's memory_recall, memory_store, memory_forget)
 * so ACP sessions running Claude Code can use them.
 *
 * Run via: node --import tsx src/mcp/plugin-tools-serve.ts
 * Or: bun src/mcp/plugin-tools-serve.ts
 */
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { loadConfig } from "../config/config.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { formatErrorMessage } from "../infra/errors.js";
import { routeLogsToStderr } from "../logging/console.js";
import { resolvePluginTools } from "../plugins/tools.js";
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "../shared/string-coerce.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import { VERSION } from "../version.js";
import { createPluginToolsMcpHandlers } from "./plugin-tools-handlers.js";

export function resolvePluginToolsMcpContext(params: {
  config?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
}) {
  const env = params.env ?? process.env;
  const senderIsOwnerRaw = normalizeOptionalLowercaseString(env.OPENCLAW_MCP_SENDER_IS_OWNER);
  return {
    config: params.config,
    sessionKey: normalizeOptionalString(env.OPENCLAW_MCP_SESSION_KEY),
    messageChannel: normalizeMessageChannel(env.OPENCLAW_MCP_MESSAGE_CHANNEL) ?? undefined,
    agentAccountId: normalizeOptionalString(env.OPENCLAW_MCP_ACCOUNT_ID),
    senderIsOwner:
      senderIsOwnerRaw === "true" ? true : senderIsOwnerRaw === "false" ? false : undefined,
  };
}

function resolveTools(config: OpenClawConfig, env?: NodeJS.ProcessEnv): AnyAgentTool[] {
  return resolvePluginTools({
    context: resolvePluginToolsMcpContext({ config, env }),
    suppressNameConflicts: true,
  });
}

export function createPluginToolsMcpServer(
  params: {
    config?: OpenClawConfig;
    tools?: AnyAgentTool[];
    env?: NodeJS.ProcessEnv;
  } = {},
): Server {
  const cfg = params.config ?? loadConfig();
  const tools = params.tools ?? resolveTools(cfg, params.env);
  const handlers = createPluginToolsMcpHandlers(tools);

  const server = new Server(
    { name: "openclaw-plugin-tools", version: VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, handlers.listTools);

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return await handlers.callTool(request.params);
  });

  return server;
}

export async function servePluginToolsMcp(): Promise<void> {
  // MCP stdio requires stdout to stay protocol-only.
  routeLogsToStderr();

  const config = loadConfig();
  const tools = resolveTools(config, process.env);
  const server = createPluginToolsMcpServer({ config, tools, env: process.env });
  if (tools.length === 0) {
    process.stderr.write("plugin-tools-serve: no plugin tools found\n");
  }

  const transport = new StdioServerTransport();

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    process.stdin.off("end", shutdown);
    process.stdin.off("close", shutdown);
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    void server.close();
  };

  process.stdin.once("end", shutdown);
  process.stdin.once("close", shutdown);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await server.connect(transport);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  servePluginToolsMcp().catch((err) => {
    process.stderr.write(`plugin-tools-serve: ${formatErrorMessage(err)}\n`);
    process.exit(1);
  });
}
