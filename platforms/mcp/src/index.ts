#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRedisTools } from "./tools/redis.js";
import { registerSumoLogicTools } from "./tools/sumologic.js";

const server = new McpServer({
  name: "sentinal",
  version: "1.1.0",
});

// Register all tool modules
registerRedisTools(server);
registerSumoLogicTools(server);

// Future: registerDockerTools(server);
// Future: registerKubernetesTools(server);
// Future: registerGithubActionsTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Sentinal MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
