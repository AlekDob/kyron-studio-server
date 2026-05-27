import fs from "node:fs/promises";
import path from "node:path";
import { resolveExportDir } from "./reader.js";

export interface UpdateFields {
  nome?: string;
  sitoUfficiale?: string;
  codiceMeccanografico?: string;
  streetAddress1?: string;
  postalCode?: string;
  city?: string;
  countryArea?: string;
  phone?: string;
  shipToSchool?: boolean;
  status?: string;
}

function parseFrontmatterRaw(raw: string): {
  entries: Array<[string, string]>;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { entries: [], body: raw };
  const entries: Array<[string, string]> = [];
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(": ");
    if (idx === -1) continue;
    entries.push([line.slice(0, idx).trim(), line.slice(idx + 2).trim()]);
  }
  return { entries, body: match[2] };
}

function parseJsonSafe(val: string): unknown {
  try {
    return JSON.parse(val);
  } catch {
    return val;
  }
}

export async function updatePortal(
  slug: string,
  updates: UpdateFields,
): Promise<{ ok: boolean; slug: string; updatedFields: string[] }> {
  const dir = resolveExportDir();
  const filePath = path.join(dir, `${slug}.md`);
  const raw = await fs.readFile(filePath, "utf-8");
  const { entries, body } = parseFrontmatterRaw(raw);

  const addressFields = [
    "streetAddress1",
    "postalCode",
    "city",
    "countryArea",
    "phone",
  ] as const;
  const updatedFields: string[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (val == null) continue;
    if (addressFields.includes(key as (typeof addressFields)[number])) {
      const addrIdx = entries.findIndex(([k]) => k === "schoolAddress");
      if (addrIdx !== -1) {
        const addr = parseJsonSafe(entries[addrIdx][1]) as Record<
          string,
          unknown
        >;
        addr[key] = val;
        entries[addrIdx][1] = JSON.stringify(addr);
        updatedFields.push(`schoolAddress.${key}`);
      }
    } else {
      const idx = entries.findIndex(([k]) => k === key);
      if (idx !== -1) {
        entries[idx][1] = JSON.stringify(val);
      } else {
        entries.push([key, JSON.stringify(val)]);
      }
      updatedFields.push(key);
    }
  }

  const fm = entries.map(([k, v]) => `${k}: ${v}`).join("\n");
  await fs.writeFile(filePath, `---\n${fm}\n---\n${body}`, "utf-8");
  return { ok: true, slug, updatedFields };
}

export async function deletePortal(
  slug: string,
): Promise<{ ok: boolean; slug: string }> {
  const dir = resolveExportDir();
  const filePath = path.join(dir, `${slug}.md`);
  await fs.unlink(filePath);
  return { ok: true, slug };
}

export async function savePortalLogo(
  slug: string,
  data: Buffer,
  ext: string,
): Promise<{ ok: boolean; filename: string }> {
  const dir = resolveExportDir();
  const logosDir = path.join(dir, "logos");
  await fs.mkdir(logosDir, { recursive: true });
  const filename = `${slug}.${ext}`;
  await fs.writeFile(path.join(logosDir, filename), data);

  const filePath = path.join(dir, `${slug}.md`);
  try {
    await fs.access(filePath);
    const raw = await fs.readFile(filePath, "utf-8");
    const { entries, body } = parseFrontmatterRaw(raw);
    const brandIdx = entries.findIndex(([k]) => k === "branding");
    if (brandIdx !== -1) {
      const branding = parseJsonSafe(entries[brandIdx][1]) as Record<
        string,
        unknown
      >;
      branding.logo = `logos/${filename}`;
      entries[brandIdx][1] = JSON.stringify(branding);
      const fm = entries.map(([k, v]) => `${k}: ${v}`).join("\n");
      await fs.writeFile(filePath, `---\n${fm}\n---\n${body}`, "utf-8");
    }
  } catch {
    // portal .md not yet saved — logo file is standalone, agent will
    // reference it via branding.logo when calling save_pending_school
  }
  return { ok: true, filename };
}
