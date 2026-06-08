import type { PendingSchool } from "./schema.js";
import {
  getPortalsGateway,
  PORTALS_COLLECTION,
} from "@/features/portals/gateway.js";
import { findPortalDoc } from "@/features/portals/reader.js";

// Brain: decision-016 — l'agente onboarding salva la nuova scuola direttamente
// in Payload (collection pending-schools) via gateway REST. La firma esposta
// (pendingSchoolSlugExists / writePendingSchoolMarkdown) e' invariata per
// non rompere agent.ts. Il nome del file resta "markdown-writer" per minimo
// diff su agent.ts; semantica: Payload writer.

export interface WriteResult {
  slug: string;
  filePath: string;
  alreadyExisted: boolean;
}

export async function pendingSchoolSlugExists(
  slug: string,
): Promise<boolean> {
  const doc = await findPortalDoc(slug);
  return Boolean(doc);
}

function toPayloadDoc(doc: PendingSchool, requestedBy: string) {
  return {
    slug: doc.slug,
    nome: doc.nome,
    status: "draft",
    collectedBy: "agent",
    // Email dell'agente Studio loggato che ha avviato l'onboarding.
    requestedBy,
    sitoUfficiale: doc.sitoUfficiale ?? "",
    codiceMeccanografico: doc.codiceMeccanografico ?? "TBD",
    schoolAddress: {
      ...doc.schoolAddress,
      phone: doc.schoolAddress.phone ?? "",
    },
    branding: {
      nome: doc.branding.nome,
      // logo nullable nello schema agente; in Payload e' upload->media (ID).
      // L'agente passa null in fase di save_pending_school. Il logo viene
      // caricato dopo via savePortalLogo (Fase 5 — collection Media).
    },
    shipToSchool: doc.shipToSchool,
    shippingMethodLabel: doc.shippingMethodLabel,
    shippingPriceEur: doc.shippingPriceEur,
    catalog: doc.catalog,
    bundles: doc.bundles,
  };
}

export async function writePendingSchoolMarkdown(
  doc: PendingSchool,
  requestedBy: string,
): Promise<WriteResult> {
  const gw = getPortalsGateway();
  const existing = await findPortalDoc(doc.slug);
  const payloadDoc = toPayloadDoc(doc, requestedBy);

  if (existing) {
    await gw.update(PORTALS_COLLECTION, String(existing.id), payloadDoc);
    console.log(`[onboard] updated pending-schools/${doc.slug} (id=${existing.id})`);
    return {
      slug: doc.slug,
      filePath: `payload://${PORTALS_COLLECTION}/${doc.slug}`,
      alreadyExisted: true,
    };
  }

  const res = await gw.create(PORTALS_COLLECTION, payloadDoc);
  console.log(
    `[onboard] created pending-schools/${doc.slug} (id=${res.data.id})`,
  );
  return {
    slug: doc.slug,
    filePath: `payload://${PORTALS_COLLECTION}/${doc.slug}`,
    alreadyExisted: false,
  };
}
