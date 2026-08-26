// Client Meta Marketing API (Graph v21) per le campagne pubblicitarie Kyron.
// Solo lettura: leggiamo /insights, non tocchiamo mai budget o stati campagna.
// Niente SDK: sono due GET, il pacchetto ufficiale pesa piu' del codice.

const GRAPH = "https://graph.facebook.com/v21.0";

// I range di Ada tradotti nei date_preset di Meta. "week"/"month" sono
// dall'inizio del periodo a oggi, come nel modulo Analytics.
const PRESETS: Record<string, string> = {
  today: "today",
  yesterday: "yesterday",
  week: "this_week_mon_today",
  month: "this_month",
  "7d": "last_7d",
  "30d": "last_30d",
  "90d": "last_90d",
};

export interface MetaCampaign {
  id: string;
  name: string;
  spendEur: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpcEur: number;
  /** Conversioni dal pixel, per tipo di azione (es. Lead, Purchase). */
  actions: Array<{ type: string; count: number }>;
}

interface InsightRow {
  campaign_id?: string;
  campaign_name?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  actions?: Array<{ action_type: string; value: string }>;
}

const num = (v: string | undefined): number => (v ? Number(v) : 0);
const round2 = (n: number): number => Math.round(n * 100) / 100;

// L'account id va scritto con il prefisso act_ nel path; accettiamo la env in
// entrambe le forme perche' la Business Suite lo mostra a volte senza.
function accountPath(): string {
  const raw = (process.env.META_AD_ACCOUNT_ID ?? "").trim();
  if (!raw) throw new Error("META_AD_ACCOUNT_ID non configurata");
  return raw.startsWith("act_") ? raw : `act_${raw}`;
}

function token(): string {
  const t = (process.env.META_ACCESS_TOKEN ?? "").trim();
  if (!t) throw new Error("META_ACCESS_TOKEN non configurata");
  return t;
}

// Il Graph API risponde 200 con {error:{message}} in alcuni casi e non-200 in
// altri: normalizziamo su Error, i tool poi lo trasformano in dato.
async function graph<T>(path: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ...params, access_token: token() });
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const body = (await res.json()) as { error?: { message: string }; data?: unknown };
  if (body.error) throw new Error(`Meta: ${body.error.message}`);
  if (!res.ok) throw new Error(`Meta: HTTP ${res.status}`);
  return body as T;
}

function toCampaign(row: InsightRow): MetaCampaign {
  return {
    id: row.campaign_id ?? "",
    name: row.campaign_name ?? "(senza nome)",
    spendEur: round2(num(row.spend)),
    impressions: num(row.impressions),
    clicks: num(row.clicks),
    ctr: round2(num(row.ctr)),
    cpcEur: round2(num(row.cpc)),
    actions: (row.actions ?? []).map((a) => ({
      type: a.action_type,
      count: num(a.value),
    })),
  };
}

const FIELDS =
  "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions";

/** Tutte le campagne con spesa nel periodo, ordinate per spesa decrescente. */
export async function fetchCampaigns(range: string): Promise<MetaCampaign[]> {
  const { data } = await graph<{ data: InsightRow[] }>(`${accountPath()}/insights`, {
    fields: FIELDS,
    level: "campaign",
    date_preset: PRESETS[range] ?? "last_7d",
    limit: "50",
  });
  return data.map(toCampaign).sort((a, b) => b.spendEur - a.spendEur);
}

/** Dettaglio di una campagna, spaccato per adset. */
export async function fetchCampaignDetail(
  campaignId: string,
  range: string,
): Promise<{ campaign: MetaCampaign | null; adsets: MetaCampaign[] }> {
  const preset = PRESETS[range] ?? "last_7d";
  const [top, breakdown] = await Promise.all([
    graph<{ data: InsightRow[] }>(`${campaignId}/insights`, {
      fields: FIELDS,
      date_preset: preset,
    }),
    graph<{ data: InsightRow[] }>(`${campaignId}/insights`, {
      fields: `${FIELDS},adset_name`,
      level: "adset",
      date_preset: preset,
      limit: "50",
    }),
  ]);
  const adsets = breakdown.data.map((row) => ({
    ...toCampaign(row),
    name: (row as InsightRow & { adset_name?: string }).adset_name ?? "(adset)",
  }));
  return {
    campaign: top.data[0] ? toCampaign(top.data[0]) : null,
    adsets: adsets.sort((a, b) => b.spendEur - a.spendEur),
  };
}
