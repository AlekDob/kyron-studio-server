import fs from "node:fs/promises";
import path from "node:path";

export interface PortalSummary {
  slug: string;
  nome: string;
  city: string;
  countryArea: string;
  status: string;
  collectedBy: string;
  collectedAt: string;
  bundleCount: number;
  productCount: number;
}

export interface PortalDetail extends PortalSummary {
  sitoUfficiale: string;
  codiceMeccanografico: string;
  schoolAddress: Record<string, unknown>;
  branding: Record<string, unknown>;
  shipToSchool: boolean;
  shippingMethodLabel: string;
  shippingPriceEur: number;
  catalog: { visibleSlugs: string[]; hiddenSlugs: string[] };
  bundles: Array<{
    slug: string;
    name: string;
    finalPriceEur: number;
    components: Array<Record<string, unknown>>;
  }>;
}

const DEFAULT_DIR = "../media/pending-schools-export";

function resolveExportDir(): string {
  const fromEnv = process.env.PENDING_SCHOOLS_EXPORT_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), DEFAULT_DIR);
}

function parseFrontmatter(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(": ");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 2).trim();
    try {
      result[key] = JSON.parse(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function toSummary(data: Record<string, unknown>): PortalSummary {
  const addr = (data.schoolAddress as Record<string, string>) ?? {};
  const catalog = (data.catalog as { visibleSlugs?: string[] }) ?? {};
  const bundles = (data.bundles as unknown[]) ?? [];
  return {
    slug: String(data.slug ?? ""),
    nome: String(data.nome ?? ""),
    city: String(addr.city ?? ""),
    countryArea: String(addr.countryArea ?? ""),
    status: String(data.status ?? "draft"),
    collectedBy: String(data.collectedBy ?? "agent"),
    collectedAt: String(data.collectedAt ?? ""),
    bundleCount: bundles.length,
    productCount: catalog.visibleSlugs?.length ?? 0,
  };
}

export async function listPortals(): Promise<PortalSummary[]> {
  const dir = resolveExportDir();
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const mdFiles = files.filter((f) => f.endsWith(".md")).sort();
  const results: PortalSummary[] = [];
  for (const file of mdFiles) {
    const raw = await fs.readFile(path.join(dir, file), "utf-8");
    const data = parseFrontmatter(raw);
    if (data.slug) results.push(toSummary(data));
  }
  return results;
}

export async function getPortal(slug: string): Promise<PortalDetail | null> {
  const dir = resolveExportDir();
  const filePath = path.join(dir, `${slug}.md`);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
  const data = parseFrontmatter(raw);
  if (!data.slug) return null;
  const summary = toSummary(data);
  return {
    ...summary,
    sitoUfficiale: String(data.sitoUfficiale ?? ""),
    codiceMeccanografico: String(data.codiceMeccanografico ?? ""),
    schoolAddress: (data.schoolAddress as Record<string, unknown>) ?? {},
    branding: (data.branding as Record<string, unknown>) ?? {},
    shipToSchool: Boolean(data.shipToSchool),
    shippingMethodLabel: String(data.shippingMethodLabel ?? ""),
    shippingPriceEur: Number(data.shippingPriceEur ?? 0),
    catalog: (data.catalog as PortalDetail["catalog"]) ?? {
      visibleSlugs: [],
      hiddenSlugs: [],
    },
    bundles: (data.bundles as PortalDetail["bundles"]) ?? [],
  };
}
