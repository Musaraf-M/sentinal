# @md-musaraf/sentinal-mcp

MCP server for infrastructure monitoring. Works with Claude, Cursor, GitHub Copilot, Cline, Warp, Gemini CLI, and any MCP-compatible AI assistant.

Monitor Redis health, BullMQ queues, Sumo Logic logs, metrics, collectors, and dashboards — all through natural conversation with your AI assistant.

## Install

Add to your MCP client config:

```json
{
  "mcpServers": {
    "sentinal": {
      "command": "npx",
      "args": ["@md-musaraf/sentinal-mcp"],
      "env": {
        "REDIS_URL": "redis://localhost:6379",
        "SUMO_ACCESS_ID": "your-access-id",
        "SUMO_ACCESS_KEY": "your-access-key",
        "SUMO_REGION": "us1"
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

### Sumo Logic

| Tool | Description |
|---|---|
| `sumo_ping` | Test connectivity and authentication to Sumo Logic |
| `sumo_health` | Comprehensive health report — collectors, monitors, account |
| `sumo_search` | Run a raw Sumo Logic query (full query language) |
| `sumo_logs` | Simple log search by keyword, source, or category |
| `sumo_metrics` | Query time-series metrics |
| `sumo_dashboards` | List dashboards with name, ID, and description |
| `sumo_monitors` | List monitors and alerts, filter by status |
| `sumo_collectors` | List collectors with health status (alive/dead) |

## Example Usage

Just ask your AI assistant:

- *"Check my Redis health"*
- *"Are any BullMQ queues backing up?"*
- *"Show me failed jobs in the email-queue"*
- *"Why is Redis slow?"*
- *"How much memory is Redis using?"*
- *"Find stale jobs in the payment-queue"*
- *"Check my Sumo Logic health"*
- *"Search logs for 'error 500' in the last hour"*
- *"Are any Sumo Logic collectors offline?"*
- *"Show me alerting monitors"*

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `SUMO_ACCESS_ID` | — | Sumo Logic Access ID |
| `SUMO_ACCESS_KEY` | — | Sumo Logic Access Key |
| `SUMO_REGION` | `us1` | Sumo Logic region (us1, us2, eu, au, de, jp, ca, in, fed) |

Each tool also accepts per-call parameters to override the defaults.

## Upcoming Modules

- Docker — container health, logs, resource usage
- Kubernetes — pod status, restart counts, resource limits
- GitHub Actions — workflow runs, failures, re-triggers
- Vercel — deployment status, rollbacks

## Links

- [GitHub](https://github.com/Musaraf-M/sentinal)
- [Report Issues](https://github.com/Musaraf-M/sentinal/issues)

## License

MIT
