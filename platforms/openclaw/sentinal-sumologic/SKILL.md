---
name: sentinal-sumologic
description: "Monitor Sumo Logic health, search logs, query metrics, check collectors, dashboards, and monitors. Read-only observability through natural conversation."
version: 1.0.0
homepage: https://github.com/Musaraf-M/sentinal
user-invocable: true
metadata:
  openclaw:
    emoji: "📊"
    requires:
      bins: ["curl", "jq"]
      anyBins: ["bash", "sh"]
    primaryEnv: SUMO_ACCESS_ID
    envVars:
      - name: SUMO_ACCESS_ID
        required: true
        description: "Sumo Logic Access ID"
      - name: SUMO_ACCESS_KEY
        required: true
        description: "Sumo Logic Access Key"
      - name: SUMO_REGION
        required: false
        description: "Sumo Logic region (default: us1). Options: us1, us2, eu, au, de, jp, ca, in, fed"
    os: ["darwin", "linux"]
---

# Sentinal Sumo Logic

Monitor Sumo Logic health, search logs, query metrics, inspect collectors, dashboards, and monitors — all through natural conversation. Read-only, safe for production.

## When to Use

✅ USE this skill when:
- User asks about Sumo Logic health or status
- User wants to search logs or find specific log entries
- User asks about collectors — which are alive, dead, or offline
- User wants to check monitor alerts (Critical, Warning)
- User asks about dashboards or wants a list
- User wants to query time-series metrics
- User needs to troubleshoot log ingestion or missing data
- User mentions Sumo Logic, SumoLogic, or "sumo"

## When NOT to Use

❌ DON'T use this skill when:
- User wants to manage Splunk, Datadog, or other non-Sumo tools
- User wants to create or modify collectors, monitors, or dashboards
- User needs help writing application logging code
- User wants to set up Sumo Logic from scratch

## Safety Rules

⚠️ CRITICAL: This skill is READ-ONLY. No exceptions.
- NEVER create, modify, or delete collectors, monitors, dashboards, or any Sumo Logic resources
- NEVER expose full Access ID or Access Key in output — always mask credentials
- NEVER store or log credentials to files
- When in doubt, show the curl command first and ask for confirmation

## Connection

All API calls use Basic Auth with Access ID and Access Key:
```bash
AUTH=$(echo -n "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" | base64)
curl -s -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" "$BASE_URL/v1/collectors"
```

### Region Base URLs
| Region | Base URL |
|--------|----------|
| us1 (default) | `https://api.sumologic.com/api` |
| us2 | `https://api.us2.sumologic.com/api` |
| eu | `https://api.eu.sumologic.com/api` |
| au | `https://api.au.sumologic.com/api` |
| de | `https://api.de.sumologic.com/api` |
| jp | `https://api.jp.sumologic.com/api` |
| ca | `https://api.ca.sumologic.com/api` |
| in | `https://api.in.sumologic.com/api` |
| fed | `https://api.fed.sumologic.com/api` |

## API Recipes

### Test Connectivity
```bash
curl -s -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" \
  "https://api.${SUMO_REGION:-us1}.sumologic.com/api/v1/collectors?limit=1"
```

### List Collectors
```bash
curl -s -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" \
  "https://api.${SUMO_REGION:-us1}.sumologic.com/api/v1/collectors?limit=100" | jq '.collectors[] | {name, alive, collectorType}'
```

### Find Dead Collectors
```bash
curl -s -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" \
  "https://api.${SUMO_REGION:-us1}.sumologic.com/api/v1/collectors?limit=200" | jq '.collectors[] | select(.alive == false) | {name, collectorType}'
```

### List Alerting Monitors
```bash
curl -s -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" \
  "https://api.${SUMO_REGION:-us1}.sumologic.com/api/v1/monitors/search?query=status:Critical%20OR%20status:Warning&limit=20" | jq '.data[] | {name, status}'
```

### List Dashboards
```bash
curl -s -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" \
  "https://api.${SUMO_REGION:-us1}.sumologic.com/api/v2/dashboards?limit=50" | jq '.dashboards[] | {id, title}'
```

### Query Metrics
```bash
curl -s -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" \
  -X POST "https://api.${SUMO_REGION:-us1}.sumologic.com/api/v1/metricsQueries" \
  -H "Content-Type: application/json" \
  -d '{"queries":[{"rowId":"A","query":"metric=CPU_LoadAvg_1min","quantization":0,"rollup":"Avg"}],"timeRange":{"type":"BeginBoundedTimeRange","from":{"type":"RelativeTimeRangeBoundary","relativeTime":"-1h"},"to":{"type":"Now"}}}'
```

## Async Search Job Flow

Sumo Logic log searches are asynchronous. The flow is:

1. **Create job**: `POST /v1/search/jobs` with query, from, to
2. **Poll status**: `GET /v1/search/jobs/{id}` until `state` is `DONE GATHERING RESULTS`
3. **Fetch results**: `GET /v1/search/jobs/{id}/messages?offset=0&limit=100`
4. **Clean up**: `DELETE /v1/search/jobs/{id}` (ALWAYS do this)

```bash
# Create
JOB_ID=$(curl -s -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" \
  -X POST "https://api.sumologic.com/api/v1/search/jobs" \
  -H "Content-Type: application/json" \
  -d '{"query":"error","from":"-15m","to":"now"}' | jq -r '.id')

# Poll (repeat until done)
curl -s -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" \
  "https://api.sumologic.com/api/v1/search/jobs/$JOB_ID" | jq '.state'

# Fetch messages
curl -s -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" \
  "https://api.sumologic.com/api/v1/search/jobs/$JOB_ID/messages?offset=0&limit=25"

# Clean up (always)
curl -s -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" \
  -X DELETE "https://api.sumologic.com/api/v1/search/jobs/$JOB_ID"
```

## Troubleshooting Decision Trees

### Collector offline
1. Check collector list → find dead collectors
2. Verify host is reachable (ping/ssh)
3. Check collector service: `systemctl status collector` or check logs at `/opt/SumoCollector/logs/`
4. Check if Access Key is still valid
5. Check firewall rules — collector needs outbound HTTPS to Sumo Logic

### Missing log data
1. Check collector health → is it alive?
2. Check source configuration → is the path/pattern correct?
3. Check processing rules → are logs being filtered out?
4. Search with broader time range and fewer filters
5. Check ingestion lag — data may arrive with delay

### Monitor false alerts
1. Get monitor details → check query and thresholds
2. Run the same query manually → verify results
3. Check time range — is the window too narrow?
4. Check for data gaps → MissingData triggers

### Slow search queries
1. Narrow the time range (start with -15m, not -24h)
2. Add `_sourceCategory` or `_source` filters
3. Use `limit` to cap results
4. Avoid `*` wildcards at the start of search terms
5. Use `count by` or `sum by` for aggregation instead of returning raw logs

## Diagnostics — Full Health Check

Run the health check script for a comprehensive overview:
```bash
bash scripts/sumo-health.sh
```

This script outputs:
- Connectivity status
- Collector health (alive/dead counts)
- Alerting monitors (Critical/Warning)
- Summary with warnings

## Notes

- All API calls are read-only — this skill never modifies Sumo Logic state
- Rate limit is 4 requests per second — the script respects this
- Search jobs MUST be cleaned up with DELETE to avoid orphan jobs
- Region defaults to `us1` if `SUMO_REGION` is not set
- For FedRAMP deployments, use region `fed`
- Requires `curl` and `jq` installed on the system
