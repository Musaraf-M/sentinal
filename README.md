# Sentinal

[![npm](https://img.shields.io/npm/v/@md-musaraf/sentinal-mcp)](https://www.npmjs.com/package/@md-musaraf/sentinal-mcp)
[![Glama](https://glama.ai/mcp/servers/Musaraf-M/sentinal/badges/score.svg)](https://glama.ai/mcp/servers/Musaraf-M/sentinal)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Infrastructure monitoring tools for AI assistants. One codebase, multiple platforms.

Ask your AI assistant to check Redis health, inspect BullMQ queues, diagnose slow queries — all through natural conversation.

## Platforms

| Platform | Distribution | Install |
|---|---|---|
| **Claude, Cursor, Copilot, Cline, Warp, Gemini CLI** | MCP Server (npm) | `npx @md-musaraf/sentinal-mcp` |
| **OpenClaw** | ClawHub | `clawhub install sentinal-redis` |
| **ChatGPT** | GPT Store | Coming soon |
| **Raycast** | Raycast Store | Coming soon |

## Modules

| Module | Status | What it monitors |
|---|---|---|
| **Redis** | ✅ Ready | Server health, memory, slow queries, clients, BullMQ queues |
| **Docker** | 🔜 Planned | Container health, logs, resource usage |
| **Kubernetes** | 🔜 Planned | Pod status, restart counts, resource limits |
| **GitHub Actions** | 🔜 Planned | Workflow runs, failures, re-triggers |
| **Vercel** | 🔜 Planned | Deployment status, rollbacks |

## MCP Server

Works with any AI tool that supports [Model Context Protocol](https://modelcontextprotocol.io) — Claude Desktop, Claude Code, Cursor, GitHub Copilot, Cline, Warp, Gemini CLI, Continue, and more.

### Install

Add to your MCP client config:

```json
{
  "mcpServers": {
    "sentinal": {
      "command": "npx",
      "args": ["@md-musaraf/sentinal-mcp"],
      "env": {
        "REDIS_URL": "redis://localhost:6379"
      }
    }
  }
}
```

### Tools

| Tool | Description |
|---|---|
| `redis_ping` | Test connectivity to a Redis instance |
| `redis_health` | Full health report — server, memory, clients, slow queries, BullMQ queues |
| `redis_memory` | Deep memory analysis with fragmentation diagnostics |
| `redis_slowlog` | Inspect slow queries |
| `bullmq_list` | List all BullMQ queues with job counts per state |
| `bullmq_failed_jobs` | Inspect failed jobs with payloads and stack traces |
| `bullmq_job_details` | Full details of a specific job |
| `bullmq_stale_jobs` | Find jobs stuck in active state |

### Example Usage

Just ask your AI assistant:

- *"Check my Redis health"*
- *"Are any BullMQ queues backing up?"*
- *"Show me failed jobs in the email-queue"*
- *"Why is Redis slow?"*
- *"How much memory is Redis using?"*
- *"Find stale jobs in the payment-queue"*

## OpenClaw Skills

Install individual skills from [ClawHub](https://clawhub.ai):

```bash
clawhub install sentinal-redis
```

The skill teaches your OpenClaw assistant to monitor Redis and BullMQ using `redis-cli`. No code required — just install and ask.

## Project Structure

```
sentinal/
├── core/                     # Shared knowledge and scripts
│   ├── redis/
│   ├── docker/
│   └── kubernetes/
├── platforms/
│   ├── mcp/                  # MCP Server → npm
│   ├── openclaw/             # OpenClaw Skills → ClawHub
│   ├── chatgpt/              # Custom GPT → GPT Store
│   └── raycast/              # Extension → Raycast Store
└── scripts/                  # Build and publish automation
```

## Development

### Prerequisites

- Node.js 22+
- pnpm 10+

### Setup

```bash
git clone https://github.com/Musaraf-M/sentinal.git
cd sentinal
pnpm install
```

### Build

```bash
pnpm build
```

### Run MCP server locally

```bash
node platforms/mcp/dist/index.js
```

## Contributing

Contributions are welcome! Areas where help is needed:

- New monitoring modules (Docker, Kubernetes, GitHub Actions)
- New platform adapters
- Bug fixes and improvements

## License

MIT
