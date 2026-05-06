# Sumo Logic API Quick Reference

## Authentication

Basic Auth with Access ID and Access Key:
```bash
curl -u "$SUMO_ACCESS_ID:$SUMO_ACCESS_KEY" https://api.<region>.sumologic.com/api/v1/collectors
```

## Region Base URLs

| Region | Base URL |
|--------|----------|
| us1 | `https://api.sumologic.com/api` |
| us2 | `https://api.us2.sumologic.com/api` |
| eu | `https://api.eu.sumologic.com/api` |
| au | `https://api.au.sumologic.com/api` |
| de | `https://api.de.sumologic.com/api` |
| jp | `https://api.jp.sumologic.com/api` |
| ca | `https://api.ca.sumologic.com/api` |
| in | `https://api.in.sumologic.com/api` |
| fed | `https://api.fed.sumologic.com/api` |

## Rate Limits

- **4 requests per second** for most API endpoints
- Search Job API: creation counts as 1 request, polling is separate
- 429 Too Many Requests response when exceeded

## Key Endpoints

### Collectors
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/collectors` | List all collectors (paginated: `limit`, `offset`) |
| GET | `/v1/collectors/{id}` | Get specific collector |

### Search Jobs (Async)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/search/jobs` | Create search job |
| GET | `/v1/search/jobs/{id}` | Get job status |
| GET | `/v1/search/jobs/{id}/messages?offset=0&limit=100` | Get messages |
| GET | `/v1/search/jobs/{id}/records?offset=0&limit=100` | Get aggregated records |
| DELETE | `/v1/search/jobs/{id}` | Delete/cancel job |

**Search Job States:** `NOT STARTED` → `GATHERING RESULTS` → `DONE GATHERING RESULTS` | `CANCELLED` | `FORCE PAUSED`

### Metrics
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/metricsQueries` | Run metrics query |

### Dashboards
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v2/dashboards` | List dashboards (paginated) |
| GET | `/v2/dashboards/{id}` | Get specific dashboard |

### Monitors
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/monitors/search?query=...` | Search monitors |
| GET | `/v1/monitors/{id}` | Get specific monitor |

**Monitor Statuses:** `Normal`, `Critical`, `Warning`, `MissingData`

## Query Language Basics

### Log Search
```
_sourceCategory="prod/web" error
| where status_code >= 500
| count by _sourceHost
| sort by _count desc
```

### Common Operators
| Operator | Description |
|----------|-------------|
| `where` | Filter results |
| `count` | Count occurrences |
| `sum`, `avg`, `min`, `max` | Aggregations |
| `parse` | Extract fields from logs |
| `timeslice` | Group by time buckets |
| `sort` | Order results |
| `limit` | Cap result count |
| `outlier` | Detect anomalies |
| `predict` | Forecast values |
| `transaction` | Group related events |

### Metrics Query
```
metric=CPU_LoadAvg_1min _sourceCategory=prod
| avg by _sourceHost
```

## Pagination Pattern

Most list endpoints support `offset` and `limit` parameters:
```
GET /v1/collectors?limit=100&offset=0
GET /v1/collectors?limit=100&offset=100
```

Keep fetching until the returned array has fewer items than `limit`.
