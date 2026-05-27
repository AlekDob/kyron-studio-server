import fs from "node:fs/promises";
import path from "node:path";
import type { PendingSchool } from "./schema.js";

// Brain: WS04 — l'agente onboarding scrive un .md descriptor direttamente
// su filesystem, bypassando Payload (collection PendingSchools ha schema
// drift in dev e POST/GET ritornano 500). Lo schema del .md e' identico
// a quello prodotto dall'hook cms/payload/hooks/exportPendingSchoolMarkdown
// quando una PendingSchool passa a status=approved — cosi' il flusso
// downstream (Alek copia in kyron-ecommerce/documentation/schools/ ed
// esegue seed/onboard-school.ts --school <slug>) rimane invariato.

const DEFAULT_DIR = "../media/pending-schools-export";

export interface WriteResult {
  slug: string;
  filePath: string;
  alreadyExisted: boolean;
}

function resolveExportDir(): string {
  const fromEnv = process.env.PENDING_SCHOOLS_EXPORT_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), DEFAULT_DIR);
}

function toFrontmatter(doc: PendingSchool): string {
  const data = {
    slug: doc.slug,
    nome: doc.nome,
    sitoUfficiale: doc.sitoUfficiale ?? "TBD",
    codiceMeccanografico: doc.codiceMeccanografico ?? "TBD",
    schoolAddress: doc.schoolAddress,
    branding: { nome: doc.branding.nome, logo: doc.branding.logo ?? "TBD" },
    shipToSchool: doc.shipToSchool,
    shippingMethodLabel: doc.shippingMethodLabel,
    shippingPriceEur: doc.shippingPriceEur,
    catalog: doc.catalog,
    bundles: doc.bundles,
    status: "draft",
  };
  return Object.entries(data)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
}

function toMarkdown(doc: PendingSchool, collectedAt: string): string {
  return `---
${toFrontmatter(doc)}
collectedBy: agent
collectedAt: ${JSON.stringify(collectedAt)}
---

# ${doc.nome}

Descriptor scuola raccolto dall'agente di onboarding (Studio).

Per onboardare la scuola sul portale e-commerce:

\`\`\`bash
cp ${doc.slug}.md ~/Desktop/Dev/Personal/Kyron/ecommerce/documentation/schools/${doc.slug}.md
cd ~/Desktop/Dev/Personal/Kyron/ecommerce
npx tsx seed/onboard-school.ts --school ${doc.slug}
\`\`\`
`;
}

export async function pendingSchoolSlugExists(
  slug: string,
): Promise<boolean> {
  const filePath = path.join(resolveExportDir(), `${slug}.md`);
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function writePendingSchoolMarkdown(
  doc: PendingSchool,
): Promise<WriteResult> {
  const dir = resolveExportDir();
  const filePath = path.join(dir, `${doc.slug}.md`);
  const alreadyExisted = await pendingSchoolSlugExists(doc.slug);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, toMarkdown(doc, new Date().toISOString()), "utf-8");

  console.log(`[onboard] wrote ${filePath} (overwrite=${alreadyExisted})`);
  return { slug: doc.slug, filePath, alreadyExisted };
}
