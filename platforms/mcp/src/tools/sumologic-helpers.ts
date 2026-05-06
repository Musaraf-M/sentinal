// Sumo Logic helpers — HTTP client, rate limiter, search job poller, credentials

// ─── Region Map ───

const REGION_URLS: Record<string, string> = {
  us1: "https://api.sumologic.com/api",
  us2: "https://api.us2.sumologic.com/api",
  eu: "https://api.eu.sumologic.com/api",
  au: "https://api.au.sumologic.com/api",
  de: "https://api.de.sumologic.com/api",
  jp: "https://api.jp.sumologic.com/api",
  ca: "https://api.ca.sumologic.com/api",
  in: "https://api.in.sumologic.com/api",
  fed: "https://api.fed.sumologic.com/api",
};

export function getBaseUrl(region: string): string {
  const url = REGION_URLS[region.toLowerCase()];
  if (!url) {
    const valid = Object.keys(REGION_URLS).join(", ");
    throw new Error(`Unknown region '${region}'. Valid regions: ${valid}`);
  }
  return url;
}

// ─── Credential Resolution ───

export interface SumoCredentials {
  accessId: string;
  accessKey: string;
  region: string;
}

export function resolveCredentials(params: {
  access_id?: string;
  access_key?: string;
  region?: string;
}): SumoCredentials {
  const accessId = params.access_id || process.env.SUMO_ACCESS_ID;
  const accessKey = params.access_key || process.env.SUMO_ACCESS_KEY;
  const region = params.region || process.env.SUMO_REGION || "us1";

  if (!accessId || !accessKey) {
    throw new Error(
      "Sumo Logic credentials required. Provide access_id/access_key parameters or set SUMO_ACCESS_ID/SUMO_ACCESS_KEY environment variables."
    );
  }

  return { accessId, accessKey, region };
}

export function maskCredentials(accessId: string): string {
  if (accessId.length <= 4) return "****";
  return accessId.slice(0, 4) + "****" + accessId.slice(-2);
}

// ─── Rate Limiter ───
// Two buckets: one for user-facing tool calls (4 req/s), one for internal
// search job polling (separate so polling doesn't starve other tools).

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private maxTokens: number,
    private refillRate: number // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Wait until a token is available
    const waitMs = ((1 - this.tokens) / this.refillRate) * 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(waitMs)));
    this.refill();
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

// 4 req/s shared across user-facing tool calls
const toolBucket = new TokenBucket(4, 4);
// 2 req/s dedicated to search job polling — won't starve tool calls
const pollingBucket = new TokenBucket(2, 2);

// ─── HTTP Client ───

export async function sumoFetch(
  creds: SumoCredentials,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    usePollingBucket?: boolean;
  } = {}
): Promise<unknown> {
  const bucket = options.usePollingBucket ? pollingBucket : toolBucket;
  await bucket.acquire();

  const baseUrl = getBaseUrl(creds.region);
  const auth = Buffer.from(`${creds.accessId}:${creds.accessKey}`).toString("base64");

  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sumo Logic API ${res.status}: ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ""}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await res.json();
  }
  return await res.text();
}

// ─── Paginated Fetch ───
// Handles offset/limit pagination for list endpoints (collectors, dashboards, monitors).

export async function sumoPaginatedFetch<T>(
  creds: SumoCredentials,
  basePath: string,
  dataKey: string,
  maxItems: number = 200
): Promise<T[]> {
  const allItems: T[] = [];
  const limit = 100;
  let offset = 0;

  while (allItems.length < maxItems) {
    const sep = basePath.includes("?") ? "&" : "?";
    const data = (await sumoFetch(creds, `${basePath}${sep}limit=${limit}&offset=${offset}`)) as Record<string, unknown>;
    const items = (data[dataKey] as T[]) || [];
    allItems.push(...items);

    if (items.length < limit) break; // no more pages
    offset += limit;
  }

  return allItems.slice(0, maxItems);
}

// ─── Search Job Poller ───
// POST create → poll every 2s (using polling bucket) → GET results → DELETE cleanup.
// 60s timeout. Returns partial results with warning if timeout hit.

export interface SearchResult {
  messages: Record<string, string>[];
  records: Record<string, string>[];
  messageCount: number;
  recordCount: number;
  isPartial: boolean;
  warning?: string;
}

export async function runSearchJob(
  creds: SumoCredentials,
  query: string,
  from: string,
  to: string,
  limit: number = 100,
  timeoutMs: number = 60_000
): Promise<SearchResult> {
  // Create search job
  const createRes = (await sumoFetch(creds, "/v1/search/jobs", {
    method: "POST",
    body: { query, from, to },
  })) as { id: string };

  const jobId = createRes.id;
  const deadline = Date.now() + timeoutMs;
  let gatheringResults = false;
  let messageCount = 0;
  let recordCount = 0;
  let isPartial = false;
  let warning: string | undefined;

  try {
    // Poll until done or timeout
    while (Date.now() < deadline) {
      const status = (await sumoFetch(creds, `/v1/search/jobs/${jobId}`, {
        usePollingBucket: true,
      })) as {
        state: string;
        messageCount: number;
        recordCount: number;
      };

      messageCount = status.messageCount;
      recordCount = status.recordCount;

      if (status.state === "DONE GATHERING RESULTS") {
        gatheringResults = true;
        break;
      }

      if (status.state === "CANCELLED" || status.state === "FORCE PAUSED") {
        throw new Error(`Search job ${status.state.toLowerCase()}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!gatheringResults) {
      isPartial = true;
      warning = `⚠ PARTIAL RESULTS: Search timed out after ${timeoutMs / 1000}s. Found ${messageCount} messages and ${recordCount} records so far. Try narrowing the time range or simplifying the query.`;
    }

    // Fetch results
    const fetchLimit = Math.min(limit, 100);
    const messages: Record<string, string>[] = [];
    const records: Record<string, string>[] = [];

    if (messageCount > 0) {
      const msgRes = (await sumoFetch(creds, `/v1/search/jobs/${jobId}/messages?offset=0&limit=${fetchLimit}`, {
        usePollingBucket: true,
      })) as { messages: { map: Record<string, string> }[] };
      for (const m of msgRes.messages || []) {
        messages.push(m.map);
      }
    }

    if (recordCount > 0) {
      const recRes = (await sumoFetch(creds, `/v1/search/jobs/${jobId}/records?offset=0&limit=${fetchLimit}`, {
        usePollingBucket: true,
      })) as { records: { map: Record<string, string> }[] };
      for (const r of recRes.records || []) {
        records.push(r.map);
      }
    }

    return { messages, records, messageCount, recordCount, isPartial, warning };
  } finally {
    // Always clean up the search job
    await sumoFetch(creds, `/v1/search/jobs/${jobId}`, {
      method: "DELETE",
      usePollingBucket: true,
    }).catch(() => {});
  }
}
