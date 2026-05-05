import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Redis } from "ioredis";

function createRedisClient(url: string): Redis {
  return new Redis(url, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
  });
}

async function withRedis<T>(
  url: string,
  fn: (client: Redis) => Promise<T>
): Promise<T> {
  const client = createRedisClient(url);
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.quit().catch(() => {});
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

export function registerRedisTools(server: McpServer): void {
  // ─── redis_ping ───
  server.tool(
    "redis_ping",
    "Test connectivity to a Redis instance",
    {
      redis_url: z
        .string()
        .default("redis://localhost:6379")
        .describe("Redis connection URL"),
    },
    async ({ redis_url }) => {
      try {
        const result = await withRedis(redis_url, async (client) => {
          return await client.ping();
        });
        return {
          content: [
            {
              type: "text",
              text: result === "PONG"
                ? `✓ Redis is reachable at ${redis_url}`
                : `✗ Unexpected response: ${result}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `✗ Cannot connect to Redis at ${redis_url}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── redis_health ───
  server.tool(
    "redis_health",
    "Comprehensive Redis health report — server info, memory, clients, slow queries, and BullMQ queue depths",
    {
      redis_url: z
        .string()
        .default("redis://localhost:6379")
        .describe("Redis connection URL"),
    },
    async ({ redis_url }) => {
      try {
        const report = await withRedis(redis_url, async (client) => {
          const info = await client.info();
          const sections = parseRedisInfo(info);
          const slowlogLen = await client.call("slowlog", "len") as number;
          const queues = await discoverBullQueues(client);

          const lines: string[] = [];
          lines.push("╔════════════════════════════════════════╗");
          lines.push("║     InfraWatch Redis Health Report     ║");
          lines.push("╚════════════════════════════════════════╝");
          lines.push(`  Target: ${redis_url}`);
          lines.push(`  Time:   ${new Date().toISOString()}`);
          lines.push("");

          // Server
          lines.push("── SERVER ──");
          lines.push(`  Version: ${sections.server?.redis_version ?? "unknown"}`);
          lines.push(`  Uptime:  ${sections.server?.uptime_in_days ?? "?"} days`);
          lines.push("");

          // Memory
          lines.push("── MEMORY ──");
          const mem = sections.memory;
          if (mem) {
            lines.push(`  Used:           ${mem.used_memory_human}`);
            lines.push(`  Peak:           ${mem.used_memory_peak_human}`);
            lines.push(`  RSS:            ${mem.used_memory_rss_human}`);
            lines.push(`  Fragmentation:  ${mem.mem_fragmentation_ratio}`);
            lines.push(`  Max Memory:     ${mem.maxmemory_human || "not set"}`);
            lines.push(`  Eviction:       ${mem.maxmemory_policy || "noeviction"}`);

            const frag = parseFloat(mem.mem_fragmentation_ratio);
            if (frag > 1.5) lines.push("  ⚠ High fragmentation — consider restarting Redis");
            if (frag < 1.0) lines.push("  ⚠ Fragmentation < 1.0 — Redis may be swapping to disk!");
          }
          lines.push("");

          // Clients
          lines.push("── CLIENTS ──");
          const clients = sections.clients;
          if (clients) {
            lines.push(`  Connected: ${clients.connected_clients}`);
            lines.push(`  Blocked:   ${clients.blocked_clients}`);
            if (parseInt(clients.connected_clients) > 1000) {
              lines.push("  ⚠ High client count — check connection pooling");
            }
            if (parseInt(clients.blocked_clients) > 0) {
              lines.push("  ⚠ Blocked clients — check BLPOP/BRPOP consumers");
            }
          }
          lines.push("");

          // Slow queries
          lines.push("── SLOW QUERIES ──");
          lines.push(`  Total recorded: ${slowlogLen}`);
          if (slowlogLen > 100) {
            lines.push("  ⚠ High slow query count — review with redis_slowlog tool");
          }
          lines.push("");

          // BullMQ
          lines.push("── BULLMQ QUEUES ──");
          if (queues.length === 0) {
            lines.push("  No BullMQ queues found");
          } else {
            lines.push(
              `  ${"QUEUE".padEnd(30)} ${"WAIT".padStart(8)} ${"ACTIVE".padStart(8)} ${"DELAYED".padStart(8)} ${"FAILED".padStart(8)} ${"DONE".padStart(8)}`
            );
            for (const q of queues) {
              lines.push(
                `  ${q.name.padEnd(30)} ${String(q.wait).padStart(8)} ${String(q.active).padStart(8)} ${String(q.delayed).padStart(8)} ${String(q.failed).padStart(8)} ${String(q.completed).padStart(8)}`
              );
              if (q.wait > 100) lines.push(`  ⚠ '${q.name}' has ${q.wait} waiting jobs — possible backlog`);
              if (q.failed > 10) lines.push(`  ⚠ '${q.name}' has ${q.failed} failed jobs`);
            }
          }

          return lines.join("\n");
        });

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to generate health report: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── redis_memory ───
  server.tool(
    "redis_memory",
    "Analyze Redis memory usage — used, peak, fragmentation, big keys, and memory doctor recommendations",
    {
      redis_url: z
        .string()
        .default("redis://localhost:6379")
        .describe("Redis connection URL"),
      big_keys: z
        .boolean()
        .default(false)
        .describe("Run big keys scan (takes longer but finds memory hogs)"),
    },
    async ({ redis_url, big_keys }) => {
      try {
        const report = await withRedis(redis_url, async (client) => {
          const memInfo = await client.info("memory");
          const sections = parseRedisInfo(memInfo);
          const mem = sections.memory;

          const lines: string[] = ["── MEMORY ANALYSIS ──", ""];
          if (mem) {
            lines.push(`Used Memory:       ${mem.used_memory_human} (${mem.used_memory} bytes)`);
            lines.push(`Peak Memory:       ${mem.used_memory_peak_human}`);
            lines.push(`RSS:               ${mem.used_memory_rss_human}`);
            lines.push(`Fragmentation:     ${mem.mem_fragmentation_ratio}`);
            lines.push(`Max Memory:        ${mem.maxmemory_human || "not set"}`);
            lines.push(`Eviction Policy:   ${mem.maxmemory_policy || "noeviction"}`);
            lines.push(`Lua Memory:        ${mem.used_memory_lua_human || "0B"}`);
            lines.push(`Scripts Memory:    ${mem.used_memory_scripts_human || "0B"}`);
            lines.push("");

            const frag = parseFloat(mem.mem_fragmentation_ratio);
            if (frag > 1.5) {
              lines.push("⚠ HIGH FRAGMENTATION");
              lines.push("  Ratio > 1.5 means Redis allocated more memory than it needs.");
              lines.push("  Fix: Restart Redis to defragment, or enable activedefrag.");
            } else if (frag < 1.0) {
              lines.push("⚠ CRITICAL: SWAPPING TO DISK");
              lines.push("  Ratio < 1.0 means RSS < used_memory — Redis is using swap.");
              lines.push("  Fix: Increase available RAM or reduce maxmemory.");
            } else {
              lines.push("✓ Memory fragmentation is healthy");
            }
          }

          // Memory doctor
          try {
            const doctor = await client.call("memory", "doctor") as string;
            lines.push("");
            lines.push("── MEMORY DOCTOR ──");
            lines.push(doctor);
          } catch {
            // memory doctor not available in older Redis versions
          }

          return lines.join("\n");
        });

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to analyze memory: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── redis_slowlog ───
  server.tool(
    "redis_slowlog",
    "Show Redis slow queries — find commands that took too long to execute",
    {
      redis_url: z
        .string()
        .default("redis://localhost:6379")
        .describe("Redis connection URL"),
      count: z
        .number()
        .default(10)
        .describe("Number of slow log entries to return"),
    },
    async ({ redis_url, count }) => {
      try {
        const report = await withRedis(redis_url, async (client) => {
          const len = await client.call("slowlog", "len") as number;
          const entries = await client.call("slowlog", "get", String(count)) as any[];

          const lines: string[] = [];
          lines.push(`Slow Log (${len} total entries, showing last ${count}):`);
          lines.push("");

          if (!entries || entries.length === 0) {
            lines.push("No slow queries recorded.");
          } else {
            for (const entry of entries) {
              const [id, timestamp, duration, command] = entry;
              const date = new Date(timestamp * 1000).toISOString();
              const durationMs = (duration / 1000).toFixed(2);
              const cmd = Array.isArray(command) ? command.join(" ") : String(command);
              lines.push(`  #${id} | ${date} | ${durationMs}ms | ${cmd}`);
            }
          }

          return lines.join("\n");
        });

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get slow log: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── bullmq_list ───
  server.tool(
    "bullmq_list",
    "List all BullMQ queues with job counts per state (waiting, active, delayed, failed, completed)",
    {
      redis_url: z
        .string()
        .default("redis://localhost:6379")
        .describe("Redis connection URL"),
    },
    async ({ redis_url }) => {
      try {
        const report = await withRedis(redis_url, async (client) => {
          const queues = await discoverBullQueues(client);

          if (queues.length === 0) {
            return "No BullMQ queues found.";
          }

          const lines: string[] = [];
          lines.push(
            `${"QUEUE".padEnd(30)} ${"WAIT".padStart(8)} ${"ACTIVE".padStart(8)} ${"DELAYED".padStart(8)} ${"FAILED".padStart(8)} ${"DONE".padStart(8)}`
          );
          lines.push("─".repeat(78));

          for (const q of queues) {
            lines.push(
              `${q.name.padEnd(30)} ${String(q.wait).padStart(8)} ${String(q.active).padStart(8)} ${String(q.delayed).padStart(8)} ${String(q.failed).padStart(8)} ${String(q.completed).padStart(8)}`
            );
          }

          lines.push("");
          lines.push(`Total: ${queues.length} queue(s)`);

          return lines.join("\n");
        });

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list queues: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── bullmq_failed_jobs ───
  server.tool(
    "bullmq_failed_jobs",
    "Inspect failed jobs in a BullMQ queue — shows job ID, name, error reason, attempts, and stack trace",
    {
      redis_url: z
        .string()
        .default("redis://localhost:6379")
        .describe("Redis connection URL"),
      queue: z.string().describe("BullMQ queue name"),
      count: z
        .number()
        .default(10)
        .describe("Number of failed jobs to return"),
    },
    async ({ redis_url, queue, count }) => {
      try {
        const report = await withRedis(redis_url, async (client) => {
          const jobIds = await client.zrange(
            `bull:${queue}:failed`,
            -count,
            -1
          );

          if (jobIds.length === 0) {
            return `No failed jobs in queue '${queue}'.`;
          }

          const lines: string[] = [
            `Failed jobs in '${queue}' (${jobIds.length}):`,
            "",
          ];

          for (const jobId of jobIds) {
            const fields = await client.hmget(
              `bull:${queue}:${jobId}`,
              "name",
              "failedReason",
              "stacktrace",
              "attemptsMade",
              "timestamp",
              "data"
            );

            const [name, failedReason, stacktrace, attemptsMade, timestamp, data] = fields;

            lines.push(`── Job: ${jobId} ──`);
            lines.push(`  Name:     ${name ?? "unknown"}`);
            lines.push(`  Error:    ${failedReason ?? "unknown"}`);
            lines.push(`  Attempts: ${attemptsMade ?? "0"}`);
            if (timestamp) {
              lines.push(`  Created:  ${new Date(parseInt(timestamp)).toISOString()}`);
            }
            if (data) {
              try {
                const parsed = JSON.parse(data);
                lines.push(`  Payload:  ${JSON.stringify(parsed, null, 2).split("\n").join("\n            ")}`);
              } catch {
                lines.push(`  Payload:  ${data.substring(0, 200)}`);
              }
            }
            if (stacktrace) {
              try {
                const traces = JSON.parse(stacktrace);
                if (Array.isArray(traces) && traces.length > 0) {
                  lines.push(`  Stack:    ${traces[0].substring(0, 300)}`);
                }
              } catch {
                lines.push(`  Stack:    ${stacktrace.substring(0, 300)}`);
              }
            }
            lines.push("");
          }

          return lines.join("\n");
        });

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get failed jobs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── bullmq_job_details ───
  server.tool(
    "bullmq_job_details",
    "Get full details of a specific BullMQ job — payload, status, timestamps, error info",
    {
      redis_url: z
        .string()
        .default("redis://localhost:6379")
        .describe("Redis connection URL"),
      queue: z.string().describe("BullMQ queue name"),
      job_id: z.string().describe("Job ID to inspect"),
    },
    async ({ redis_url, queue, job_id }) => {
      try {
        const report = await withRedis(redis_url, async (client) => {
          const data = await client.hgetall(`bull:${queue}:${job_id}`);

          if (!data || Object.keys(data).length === 0) {
            return `Job '${job_id}' not found in queue '${queue}'.`;
          }

          const lines: string[] = [`Job: ${queue} / ${job_id}`, ""];

          const fieldOrder = [
            "name", "data", "opts", "timestamp", "processedOn",
            "finishedOn", "attemptsMade", "failedReason", "stacktrace",
            "returnvalue",
          ];

          for (const field of fieldOrder) {
            if (data[field] !== undefined) {
              let value = data[field];
              // Pretty-print JSON fields
              if (["data", "opts", "returnvalue"].includes(field)) {
                try {
                  value = JSON.stringify(JSON.parse(value), null, 2);
                } catch { /* keep raw */ }
              }
              // Convert timestamps
              if (["timestamp", "processedOn", "finishedOn"].includes(field) && value) {
                const ts = parseInt(value);
                if (!isNaN(ts)) {
                  value = `${new Date(ts).toISOString()} (${value})`;
                }
              }
              lines.push(`${field}: ${value}`);
            }
          }

          // Show any remaining fields
          for (const [key, value] of Object.entries(data)) {
            if (!fieldOrder.includes(key)) {
              lines.push(`${key}: ${value}`);
            }
          }

          return lines.join("\n");
        });

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get job details: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ─── bullmq_stale_jobs ───
  server.tool(
    "bullmq_stale_jobs",
    "Find stale active jobs in a BullMQ queue — jobs stuck in active state longer than expected",
    {
      redis_url: z
        .string()
        .default("redis://localhost:6379")
        .describe("Redis connection URL"),
      queue: z.string().describe("BullMQ queue name"),
      minutes: z
        .number()
        .default(10)
        .describe("Consider jobs stale if active longer than this many minutes"),
    },
    async ({ redis_url, queue, minutes }) => {
      try {
        const report = await withRedis(redis_url, async (client) => {
          const activeJobs = await client.lrange(`bull:${queue}:active`, 0, -1);
          const threshold = Date.now() - minutes * 60 * 1000;

          if (activeJobs.length === 0) {
            return `No active jobs in queue '${queue}'.`;
          }

          const stale: string[] = [];
          for (const jobId of activeJobs) {
            const processedOn = await client.hget(`bull:${queue}:${jobId}`, "processedOn");
            if (processedOn) {
              const ts = parseInt(processedOn);
              if (ts < threshold) {
                const name = await client.hget(`bull:${queue}:${jobId}`, "name");
                const ageMin = Math.round((Date.now() - ts) / 60000);
                stale.push(`  ⚠ Job ${jobId} (${name ?? "unknown"}) — active for ${ageMin}m`);
              }
            }
          }

          if (stale.length === 0) {
            return `✓ No stale jobs in '${queue}' (checked ${activeJobs.length} active jobs, threshold: ${minutes}m)`;
          }

          return [
            `Stale active jobs in '${queue}' (active > ${minutes}m):`,
            "",
            ...stale,
          ].join("\n");
        });

        return { content: [{ type: "text", text: report }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to check stale jobs: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

// ─── Helpers ───

interface QueueStats {
  name: string;
  wait: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

async function discoverBullQueues(client: Redis): Promise<QueueStats[]> {
  const queues: QueueStats[] = [];
  let cursor = "0";

  do {
    const [nextCursor, keys] = await client.scan(
      cursor,
      "MATCH",
      "bull:*:meta",
      "COUNT",
      "100"
    );
    cursor = nextCursor;

    for (const key of keys) {
      const name = key.replace(/^bull:/, "").replace(/:meta$/, "");

      const [wait, active, delayed, failed, completed] = await Promise.all([
        client.llen(`bull:${name}:wait`),
        client.llen(`bull:${name}:active`),
        client.zcard(`bull:${name}:delayed`),
        client.zcard(`bull:${name}:failed`),
        client.zcard(`bull:${name}:completed`),
      ]);

      queues.push({ name, wait, active, delayed, failed, completed });
    }
  } while (cursor !== "0");

  return queues.sort((a, b) => a.name.localeCompare(b.name));
}

function parseRedisInfo(info: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let currentSection = "default";

  for (const line of info.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      if (trimmed.startsWith("# ")) {
        currentSection = trimmed.slice(2).toLowerCase();
        sections[currentSection] = {};
      }
      continue;
    }
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx);
      const value = trimmed.slice(colonIdx + 1).trim();
      if (!sections[currentSection]) sections[currentSection] = {};
      sections[currentSection][key] = value;
    }
  }

  return sections;
}
