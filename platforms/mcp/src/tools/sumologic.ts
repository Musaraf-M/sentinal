import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  resolveCredentials,
  maskCredentials,
  sumoFetch,
  sumoPaginatedFetch,
  runSearchJob,
} from "./sumologic-helpers.js";

// Shared Zod params for credentials (reused across all tools)
const credentialParams = {
  access_id: z
    .string()
    .optional()
    .describe("Sumo Logic Access ID (falls back to SUMO_ACCESS_ID env var)"),
  access_key: z
    .string()
    .optional()
    .describe("Sumo Logic Access Key (falls back to SUMO_ACCESS_KEY env var)"),
  region: z
    .string()
    .optional()
    .describe("Sumo Logic region: us1, us2, eu, au, de, jp, ca, in, fed (falls back to SUMO_REGION, default: us1)"),
};

function errResponse(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true };
}

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function registerSumoLogicTools(server: McpServer): void {
  // ─── sumo_ping ───
  server.tool(
    "sumo_ping",
    "Test connectivity and authentication to Sumo Logic",
    { ...credentialParams },
    async (params) => {
      try {
        const creds = resolveCredentials(params);
        const data = (await sumoFetch(creds, "/v1/collectors?limit=1")) as {
          collectors: unknown[];
        };
        return textResponse(
          `✓ Connected to Sumo Logic (${creds.region}) as ${maskCredentials(creds.accessId)} — API is reachable, auth valid`
        );
      } catch (error) {
        return errResponse(
          `✗ Cannot connect to Sumo Logic: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // ─── sumo_health ───
  server.tool(
    "sumo_health",
    "Comprehensive Sumo Logic health report — collectors, monitors, account overview",
    { ...credentialParams },
    async (params) => {
      try {
        const creds = resolveCredentials(params);
        const lines: string[] = [];
        lines.push("╔════════════════════════════════════════╗");
        lines.push("║   Sentinal Sumo Logic Health Report    ║");
        lines.push("╚════════════════════════════════════════╝");
        lines.push(`  Region: ${creds.region}`);
        lines.push(`  Auth:   ${maskCredentials(creds.accessId)}`);
        lines.push(`  Time:   ${new Date().toISOString()}`);
        lines.push("");

        // Collectors — paginated
        const collectors = await sumoPaginatedFetch<{
          id: number;
          name: string;
          alive: boolean;
          collectorType: string;
        }>(creds, "/v1/collectors", "collectors");

        const alive = collectors.filter((c) => c.alive).length;
        const dead = collectors.filter((c) => !c.alive).length;

        lines.push("── COLLECTORS ──");
        lines.push(`  Total:  ${collectors.length}`);
        lines.push(`  Alive:  ${alive}`);
        lines.push(`  Dead:   ${dead}`);
        if (dead > 0) {
          lines.push(`  ⚠ ${dead} collector(s) are offline:`);
          for (const c of collectors.filter((c) => !c.alive).slice(0, 10)) {
            lines.push(`    - ${c.name} (${c.collectorType})`);
          }
          if (dead > 10) lines.push(`    ... and ${dead - 10} more`);
        }
        lines.push("");

        // Monitors — search for triggered
        try {
          const monData = (await sumoFetch(
            creds,
            "/v1/monitors/search?query=status:Critical OR status:Warning&limit=20"
          )) as { data?: { name: string; status: string; id: string }[] };

          const triggered = monData.data || [];
          lines.push("── MONITORS (ALERTING) ──");
          if (triggered.length === 0) {
            lines.push("  ✓ No monitors in Critical or Warning state");
          } else {
            const critical = triggered.filter((m) => m.status === "Critical");
            const warning = triggered.filter((m) => m.status === "Warning");
            if (critical.length > 0) {
              lines.push(`  ⚠ CRITICAL: ${critical.length}`);
              for (const m of critical.slice(0, 5)) {
                lines.push(`    - ${m.name}`);
              }
            }
            if (warning.length > 0) {
              lines.push(`  ⚠ WARNING: ${warning.length}`);
              for (const m of warning.slice(0, 5)) {
                lines.push(`    - ${m.name}`);
              }
            }
          }
        } catch {
          lines.push("── MONITORS ──");
          lines.push("  (could not fetch monitor status)");
        }
        lines.push("");

        // Account info
        try {
          const account = (await sumoFetch(creds, "/v1/account/status")) as {
            pricingModel?: string;
            canUpdatePlan?: boolean;
            planType?: string;
          };
          lines.push("── ACCOUNT ──");
          if (account.planType) lines.push(`  Plan:    ${account.planType}`);
          if (account.pricingModel) lines.push(`  Pricing: ${account.pricingModel}`);
        } catch {
          // Account endpoint may not be accessible — skip silently
        }

        // Summary
        lines.push("");
        lines.push("── SUMMARY ──");
        if (dead > 0) {
          lines.push(`  ⚠ ${dead} dead collector(s) need attention`);
        } else {
          lines.push("  ✓ All collectors online");
        }

        return textResponse(lines.join("\n"));
      } catch (error) {
        return errResponse(
          `Failed to generate health report: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // ─── sumo_search ───
  server.tool(
    "sumo_search",
    "Run a raw Sumo Logic query — power-user tool for the full query language (75+ operators)",
    {
      ...credentialParams,
      query: z.string().describe("Sumo Logic search query (raw query language)"),
      from: z
        .string()
        .default("-15m")
        .describe("Start time — ISO 8601 or relative like -15m, -1h, -24h"),
      to: z
        .string()
        .default("now")
        .describe("End time — ISO 8601 or 'now'"),
      limit: z
        .number()
        .default(50)
        .describe("Maximum number of results to return (max 100)"),
    },
    async ({ query, from, to, limit, ...creds }) => {
      try {
        const credentials = resolveCredentials(creds);
        const result = await runSearchJob(
          credentials,
          query,
          from,
          to,
          Math.min(limit, 100)
        );

        const lines: string[] = [];
        if (result.warning) {
          lines.push(result.warning);
          lines.push("");
        }
        lines.push(`Query: ${query}`);
        lines.push(`Range: ${from} → ${to}`);
        lines.push(`Messages: ${result.messageCount} total (showing ${result.messages.length})`);
        lines.push(`Records: ${result.recordCount} total (showing ${result.records.length})`);
        lines.push("");

        if (result.records.length > 0) {
          lines.push("── AGGREGATED RECORDS ──");
          for (const rec of result.records) {
            lines.push(
              Object.entries(rec)
                .map(([k, v]) => `${k}=${v}`)
                .join(" | ")
            );
          }
          lines.push("");
        }

        if (result.messages.length > 0) {
          lines.push("── LOG MESSAGES ──");
          for (const msg of result.messages) {
            const time = msg._messagetime || msg._receipttime || "";
            const raw = msg._raw || JSON.stringify(msg);
            lines.push(`[${time}] ${raw.slice(0, 500)}`);
          }
        }

        if (result.messages.length === 0 && result.records.length === 0) {
          lines.push("No results found for this query and time range.");
        }

        return textResponse(lines.join("\n"));
      } catch (error) {
        return errResponse(
          `Search failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // ─── sumo_logs ───
  server.tool(
    "sumo_logs",
    "Simple log search — find logs by keyword, source, or filter (wraps query for you)",
    {
      ...credentialParams,
      keyword: z
        .string()
        .describe("Keyword or phrase to search for in logs"),
      source: z
        .string()
        .optional()
        .describe("Filter by _source (e.g. 'apache', 'nginx')"),
      source_category: z
        .string()
        .optional()
        .describe("Filter by _sourceCategory (e.g. 'prod/web')"),
      from: z
        .string()
        .default("-15m")
        .describe("Start time — ISO 8601 or relative like -15m, -1h, -24h"),
      to: z
        .string()
        .default("now")
        .describe("End time — ISO 8601 or 'now'"),
      limit: z
        .number()
        .default(25)
        .describe("Maximum number of log messages to return"),
    },
    async ({ keyword, source, source_category, from, to, limit, ...creds }) => {
      try {
        const credentials = resolveCredentials(creds);

        // Build a smart query from the simple parameters
        const parts: string[] = [];
        if (source) parts.push(`_source="${source}"`);
        if (source_category) parts.push(`_sourceCategory="${source_category}"`);

        // If keyword looks like a raw query (has operators), use as-is
        const hasOperators = /\||\bAND\b|\bOR\b|\bNOT\b|\bwhere\b|\bparse\b/i.test(keyword);
        if (hasOperators) {
          parts.push(keyword);
        } else {
          parts.push(`"${keyword}"`);
        }

        const query = parts.join(" ");
        const result = await runSearchJob(
          credentials,
          query,
          from,
          to,
          Math.min(limit, 100)
        );

        const lines: string[] = [];
        if (result.warning) {
          lines.push(result.warning);
          lines.push("");
        }
        lines.push(`Search: ${query}`);
        lines.push(`Range: ${from} → ${to}`);
        lines.push(`Found: ${result.messageCount} messages (showing ${result.messages.length})`);
        lines.push("");

        if (result.messages.length > 0) {
          for (const msg of result.messages) {
            const time = msg._messagetime || msg._receipttime || "";
            const src = msg._source || "";
            const raw = msg._raw || JSON.stringify(msg);
            lines.push(`[${time}] [${src}] ${raw.slice(0, 500)}`);
          }
        } else {
          lines.push("No log messages found. Try broadening the time range or simplifying the keyword.");
        }

        return textResponse(lines.join("\n"));
      } catch (error) {
        return errResponse(
          `Log search failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // ─── sumo_metrics ───
  server.tool(
    "sumo_metrics",
    "Query Sumo Logic time-series metrics",
    {
      ...credentialParams,
      query: z.string().describe("Metrics query (e.g. 'metric=CPU_LoadAvg_1min _sourceCategory=prod')"),
      from: z
        .string()
        .default("-1h")
        .describe("Start time — ISO 8601 or relative like -1h, -24h"),
      to: z
        .string()
        .default("now")
        .describe("End time — ISO 8601 or 'now'"),
      max_data_points: z
        .number()
        .default(60)
        .describe("Maximum data points per time series"),
    },
    async ({ query, from, to, max_data_points, ...creds }) => {
      try {
        const credentials = resolveCredentials(creds);
        const data = (await sumoFetch(credentials, "/v1/metricsQueries", {
          method: "POST",
          body: {
            queries: [
              {
                rowId: "A",
                query,
                quantization: 0,
                rollup: "Avg",
                timeshift: 0,
              },
            ],
            timeRange: {
              type: "BeginBoundedTimeRange",
              from: { type: "RelativeTimeRangeBoundary", relativeTime: from },
              to: to === "now" ? { type: "Now" } : { type: "RelativeTimeRangeBoundary", relativeTime: to },
            },
            maxDataPoints: max_data_points,
          },
        })) as {
          queryResult?: {
            rowId: string;
            results: {
              metric: { dimensions: { key: string; value: string }[] };
              datapoints: { timestamp: number; value: number }[];
            }[];
          }[];
          errors?: { message: string }[];
        };

        const lines: string[] = [];
        lines.push(`Metrics: ${query}`);
        lines.push(`Range: ${from} → ${to}`);
        lines.push("");

        if (data.errors && data.errors.length > 0) {
          lines.push("⚠ Query errors:");
          for (const err of data.errors) {
            lines.push(`  - ${err.message}`);
          }
          return textResponse(lines.join("\n"));
        }

        const results = data.queryResult?.[0]?.results || [];
        if (results.length === 0) {
          lines.push("No metrics found for this query and time range.");
          return textResponse(lines.join("\n"));
        }

        lines.push(`Found ${results.length} time series`);
        lines.push("");

        for (const series of results.slice(0, 10)) {
          const dims = series.metric.dimensions
            .map((d) => `${d.key}=${d.value}`)
            .join(", ");
          lines.push(`── ${dims} ──`);

          const points = series.datapoints;
          if (points.length > 0) {
            const values = points.map((p) => p.value);
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            const min = Math.min(...values);
            const max = Math.max(...values);
            lines.push(`  Points: ${points.length} | Avg: ${avg.toFixed(2)} | Min: ${min.toFixed(2)} | Max: ${max.toFixed(2)}`);

            // Show last 5 data points
            for (const p of points.slice(-5)) {
              lines.push(`  ${new Date(p.timestamp).toISOString()} → ${p.value.toFixed(2)}`);
            }
          }
          lines.push("");
        }

        if (results.length > 10) {
          lines.push(`... and ${results.length - 10} more time series`);
        }

        return textResponse(lines.join("\n"));
      } catch (error) {
        return errResponse(
          `Metrics query failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // ─── sumo_dashboards ───
  server.tool(
    "sumo_dashboards",
    "List Sumo Logic dashboards with name, ID, and folder path",
    {
      ...credentialParams,
      limit: z
        .number()
        .default(50)
        .describe("Maximum number of dashboards to return"),
    },
    async ({ limit, ...creds }) => {
      try {
        const credentials = resolveCredentials(creds);
        const dashboards = await sumoPaginatedFetch<{
          id: string;
          title: string;
          description?: string;
          folderId?: string;
        }>(credentials, "/v2/dashboards", "dashboards", limit);

        const lines: string[] = [];
        lines.push(`Dashboards (${dashboards.length}):`);
        lines.push("");

        if (dashboards.length === 0) {
          lines.push("No dashboards found.");
          return textResponse(lines.join("\n"));
        }

        lines.push(`${"TITLE".padEnd(40)} ${"ID".padEnd(20)} DESCRIPTION`);
        lines.push("─".repeat(80));

        for (const d of dashboards) {
          const desc = d.description ? d.description.slice(0, 30) : "";
          lines.push(
            `${(d.title || "Untitled").slice(0, 39).padEnd(40)} ${d.id.padEnd(20)} ${desc}`
          );
        }

        return textResponse(lines.join("\n"));
      } catch (error) {
        return errResponse(
          `Failed to list dashboards: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // ─── sumo_monitors ───
  server.tool(
    "sumo_monitors",
    "List Sumo Logic monitors and alerts — filter by status (Critical, Warning, MissingData, Normal)",
    {
      ...credentialParams,
      status: z
        .string()
        .optional()
        .describe("Filter by status: Critical, Warning, MissingData, Normal (default: show all)"),
      limit: z
        .number()
        .default(50)
        .describe("Maximum number of monitors to return"),
    },
    async ({ status, limit, ...creds }) => {
      try {
        const credentials = resolveCredentials(creds);

        let query = "";
        if (status) {
          query = `status:${status}`;
        }

        const sep = query ? `?query=${encodeURIComponent(query)}&` : "?";
        const data = (await sumoFetch(
          credentials,
          `/v1/monitors/search${sep}limit=${Math.min(limit, 100)}`
        )) as { data?: { id: string; name: string; status: string; monitorType: string; description?: string }[] };

        const monitors = data.data || [];
        const lines: string[] = [];
        lines.push(`Monitors${status ? ` (${status})` : ""}: ${monitors.length}`);
        lines.push("");

        if (monitors.length === 0) {
          lines.push(status ? `No monitors with status '${status}'.` : "No monitors found.");
          return textResponse(lines.join("\n"));
        }

        lines.push(`${"NAME".padEnd(35)} ${"STATUS".padEnd(12)} ${"TYPE".padEnd(12)} ID`);
        lines.push("─".repeat(80));

        for (const m of monitors) {
          const statusIcon =
            m.status === "Critical" ? "⚠" :
            m.status === "Warning" ? "⚠" :
            m.status === "Normal" ? "✓" : "?";
          lines.push(
            `${statusIcon} ${(m.name || "").slice(0, 33).padEnd(33)} ${(m.status || "").padEnd(12)} ${(m.monitorType || "").padEnd(12)} ${m.id}`
          );
        }

        return textResponse(lines.join("\n"));
      } catch (error) {
        return errResponse(
          `Failed to list monitors: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );

  // ─── sumo_collectors ───
  server.tool(
    "sumo_collectors",
    "List Sumo Logic collectors with health status (alive/dead), type, and version",
    {
      ...credentialParams,
      limit: z
        .number()
        .default(50)
        .describe("Maximum number of collectors to return"),
    },
    async ({ limit, ...creds }) => {
      try {
        const credentials = resolveCredentials(creds);
        const collectors = await sumoPaginatedFetch<{
          id: number;
          name: string;
          alive: boolean;
          collectorType: string;
          collectorVersion?: string;
          osName?: string;
          lastSeenAlive?: number;
        }>(credentials, "/v1/collectors", "collectors", limit);

        const lines: string[] = [];
        const alive = collectors.filter((c) => c.alive).length;
        const dead = collectors.filter((c) => !c.alive).length;

        lines.push(`Collectors: ${collectors.length} total (${alive} alive, ${dead} dead)`);
        lines.push("");

        if (collectors.length === 0) {
          lines.push("No collectors found.");
          return textResponse(lines.join("\n"));
        }

        lines.push(`${"STATUS".padEnd(8)} ${"NAME".padEnd(35)} ${"TYPE".padEnd(12)} VERSION`);
        lines.push("─".repeat(75));

        for (const c of collectors) {
          const status = c.alive ? "✓ UP" : "✗ DOWN";
          const version = c.collectorVersion || "";
          lines.push(
            `${status.padEnd(8)} ${(c.name || "").slice(0, 34).padEnd(35)} ${(c.collectorType || "").padEnd(12)} ${version}`
          );
        }

        if (dead > 0) {
          lines.push("");
          lines.push(`⚠ ${dead} collector(s) are offline — check host connectivity and collector service status`);
        }

        return textResponse(lines.join("\n"));
      } catch (error) {
        return errResponse(
          `Failed to list collectors: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
