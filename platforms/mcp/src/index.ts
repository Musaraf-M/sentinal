#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRedisTools } from "./tools/redis.js";

const server = new McpServer({
  name: "infrawatch",
  version: "1.0.0",
});

// Register all tool modules
registerRedisTools(server);

// Future: registerDockerTools(server);
// Future: registerKubernetesTools(server);
// Future: registerGithubActionsTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("InfraWatch MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
