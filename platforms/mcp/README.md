# @md-musaraf/sentinal-mcp

MCP server for infrastructure monitoring. Works with Claude, Cursor, GitHub Copilot, Cline, Warp, Gemini CLI, and any MCP-compatible AI assistant.

Monitor Redis health, BullMQ queues, memory, and slow queries — all through natural conversation with your AI assistant.

## Install

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

### Claude Desktop

Add the above to `~/Library/Application Support/Claude/claude_desktop_config.json`

### Claude Code

```bash
claude mcp add sentinal npx @md-musaraf/sentinal-mcp
```

### Cursor

Add the above to `.cursor/mcp.json` in your project root.

### GitHub Copilot

Add the above to `.github/copilot/mcp.json` in your repository.

## Tools

### Redis Server

| Tool | Description |
|---|---|
| `redis_ping` | Test connectivity to a Redis instance |
| `redis_health` | Full health report — server, memory, clients, slow queries, BullMQ queues |
| `redis_memory` | Deep memory analysis with fragmentation diagnostics |
| `redis_slowlog` | Inspect slow queries |

### BullMQ Queues

| Tool | Description |
|---|---|
| `bullmq_list` | List all BullMQ queues with job counts per state |
| `bullmq_failed_jobs` | Inspect failed jobs with payloads and stack traces |
| `bullmq_job_details` | Full details of a specific job |
| `bullmq_stale_jobs` | Find jobs stuck in active state |

## Example Usage

Just ask your AI assistant:

- *"Check my Redis health"*
- *"Are any BullMQ queues backing up?"*
- *"Show me failed jobs in the email-queue"*
- *"Why is Redis slow?"*
- *"How much memory is Redis using?"*
- *"Find stale jobs in the payment-queue"*

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |

Each tool also accepts a `redis_url` parameter to override the default per-call.

## Upcoming Modules

- Docker — container health, logs, resource usage
- Kubernetes — pod status, restart counts, resource limits
- GitHub Actions — workflow runs, failures, re-triggers

## Links

- [GitHub](https://github.com/Musaraf-M/sentinal)
- [Report Issues](https://github.com/Musaraf-M/sentinal/issues)

## License

MIT
