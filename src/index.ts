interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * SEO SERP MCP — Google organic search results via DataForSEO (dataforseo.com)
 *
 * Tools:
 * - seo_serp_google: organic Google results ("who ranks for X") for a query.
 *
 * Auth: DataForSEO HTTP Basic. Pass _apiKey = base64("login:password").
 * Wave 1 = BYO-key only (the user's own DataForSEO key bears upstream cost).
 * Wave 2 (platform-keyed + metered) will add a `cost` CostModel + realCogs flag.
 */


const BASE_URL = 'https://api.dataforseo.com';

const tools: McpToolExport['tools'] = [
  {
    name: 'seo_serp_google',
    description:
      'Who ranks for `<term>` on Google — live organic search results (rank, title, domain, URL, snippet) for a keyword in a given country. SEO rank-tracking and SERP analysis. Example: seo_serp_google({ keyword: "best running shoes", location_code: 2840, _apiKey: "your-base64-key" })',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keyword: {
          type: 'string',
          description: 'Search query to look up, e.g. "best running shoes"',
        },
        location_code: {
          type: 'integer',
          description: 'DataForSEO location code (default 2840 = United States). e.g. 2826 = UK, 2124 = Canada.',
        },
        language_code: {
          type: 'string',
          description: 'Two-letter language code (default "en")',
        },
        depth: {
          type: 'integer',
          description: 'Number of organic results to return (default 10, max 20)',
        },
        _apiKey: {
          type: 'string',
          description: 'DataForSEO API key = base64("login:password") from your dataforseo.com account',
        },
      },
      required: ['keyword', '_apiKey'],
    },
  },
];

async function dfsPost(path: string, body: unknown, apiKey: string, tool: string) {
  if (!apiKey) {
    throw new Error(
      `${tool} requires a DataForSEO API key. Pass _apiKey = base64("login:password") from your DataForSEO account (sign up at dataforseo.com). This is a paid data source — bring your own key, or add credits at https://pipeworx.io/account.`,
    );
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Basic ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `DataForSEO auth failed (HTTP ${res.status}). Check _apiKey is base64("login:password") and your account is funded/verified (data endpoints return 40104 until the account is funded). Re-encode credentials and retry.`,
    );
  }
  if (!res.ok) throw new Error(`DataForSEO ${tool} error: HTTP ${res.status}`);
  const data = (await res.json()) as DfsResponse;
  if (data.status_code !== 20000) {
    throw new Error(`DataForSEO ${tool}: ${data.status_code} ${data.status_message}`);
  }
  const task = data.tasks?.[0];
  if (!task || task.status_code !== 20000) {
    throw new Error(`DataForSEO ${tool}: ${task?.status_code ?? 'no task'} ${task?.status_message ?? ''}`.trim());
  }
  return task;
}

interface DfsResponse {
  status_code: number;
  status_message: string;
  tasks?: Array<{
    status_code: number;
    status_message: string;
    cost: number;
    result?: Array<Record<string, unknown>> | null;
  }>;
}

async function serpGoogle(args: Record<string, unknown>, apiKey: string) {
  const keyword = args.keyword as string;
  if (!keyword) {
    throw new Error('seo_serp_google requires a `keyword` (e.g. "best running shoes").');
  }
  const location_code = (args.location_code as number) ?? 2840;
  const language_code = (args.language_code as string) ?? 'en';
  const depth = Math.min(Math.max(Number(args.depth ?? 10), 1), 20);

  const task = await dfsPost(
    '/v3/serp/google/organic/live/regular',
    [{ keyword, location_code, language_code, depth }],
    apiKey,
    'seo_serp_google',
  );

  const result = (task.result?.[0] ?? {}) as {
    se_results_count?: number;
    items?: Array<Record<string, unknown>>;
  };
  const items = (result.items ?? [])
    .filter((it) => it.type === 'organic')
    .map((it) => ({
      rank: it.rank_group as number,
      title: it.title as string,
      domain: it.domain as string,
      url: it.url as string,
      description: (it.description as string) ?? null,
    }));

  return {
    query: keyword,
    location_code,
    language_code,
    results: items,
    total_results: result.se_results_count ?? null,
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const apiKey = args._apiKey as string;
  delete args._apiKey;

  switch (name) {
    case 'seo_serp_google':
      return serpGoogle(args, apiKey);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Wave 1 (BYO-only): nominal access meter; user's own key bears DataForSEO COGS.
// Wave 2: replace with measured `cost` CostModel (depth=20) + realCogs gate.
export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
