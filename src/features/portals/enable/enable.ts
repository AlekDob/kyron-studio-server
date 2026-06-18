// Brain: Fase B pipeline onboarding — orchestratore "Abilita su Saleor".
// Replica gli step del seed CLI su STAGING E PROD in un colpo solo (regola
// Alek 2026-06-11: i portali vanno sempre fino in produzione), poi aggiorna il
// doc Payload (status onboarded + channelId). Idempotente: rilanciabile.
// Con Fase C (registry runtime da Payload) il portale e' live senza rebuild.
import { getPortalsGateway, PORTALS_COLLECTION } from "../gateway.js";
import { getPortal, findPortalDoc, type PortalDetail } from "../reader.js";
import {
  normalizePendingSchool,
  isProtectionSlug,
} from "@/features/onboard-school/normalize.js";
import { toEnableConfig, type EnablePortalConfig } from "./config.js";
import {
  ensureChannel,
  ensureShipping,
  ensureVoucher,
  fetchProduct,
  listChannelProductSlugs,
  resolveBundleSaving,
  setVariantPrice,
  setVisibility,
  upsertPromotion,
  variantHasCapacity,
  voucherCodeFor,
  type ProductRef,
  type SaleorTarget,
} from "./seed-steps.js";
import { saleorUrlFor } from "./saleor-admin.js";
import { opsRecalc, opsAssignStripe } from "./ops-client.js";

export interface TargetReport {
  target: SaleorTarget;
  channelId: string;
  channelCreated: boolean;
  productsPublished: number;
  promotionsApplied: number;
  vouchers: Record<string, string>; // bundleSlug -> voucherId
  promotionsOnSale: boolean | null; // null = nessuna promo da verificare
  steps: string[];
}

export interface EnableReport {
  slug: string;
  targets: TargetReport[];
  payloadUpdated: boolean;
  // Correzioni auto-applicate dalla normalizzazione pre-enable (Fase A sui
  // doc storici/modificati: SKU case, protection plan hidden, hero bundle-only).
  normalizationFixes: string[];
  // decision-020: esiti kyron-ops (recalc sconti + Stripe config). Best-effort,
  // assente se kyron-ops non e' configurato.
  ops?: { recalc?: unknown; stripe?: unknown };
}

interface PubPlan {
  mode: "visible" | "hidden-purchasable";
  capacities: Set<string> | null; // null = tutte le varianti
}

// Port di buildPubPlans del seed: unione di visibleSlugs/visibleVariants/
// hiddenSlugs + componenti bundle (che devono essere prezzati per il checkout).
function buildPubPlans(config: EnablePortalConfig): Map<string, PubPlan> {
  const plans = new Map<string, PubPlan>();
  const merge = (slug: string, mode: PubPlan["mode"], caps: Set<string> | null) => {
    const prev = plans.get(slug);
    if (!prev) {
      plans.set(slug, { mode, capacities: caps });
      return;
    }
    const nextMode =
      prev.mode === "visible" || mode === "visible" ? "visible" : "hidden-purchasable";
    const nextCaps =
      prev.capacities === null || caps === null
        ? null
        : new Set([...prev.capacities, ...caps]);
    plans.set(slug, { mode: nextMode, capacities: nextCaps });
  };
  for (const slug of config.catalog.visibleSlugs) merge(slug, "visible", null);
  for (const vv of config.catalog.visibleVariants) {
    merge(vv.productSlug, "visible", new Set([vv.value]));
  }
  for (const slug of config.catalog.hiddenSlugs) merge(slug, "hidden-purchasable", null);
  for (const b of config.bundles) {
    for (const c of b.components) {
      const cap =
        c.selection.kind === "by-attribute"
          ? c.selection.valueFilter?.capacita
          : undefined;
      merge(c.productSlug, "hidden-purchasable", cap ? new Set([cap]) : null);
    }
  }
  return plans;
}

async function applyVisibilityAndPricing(
  target: SaleorTarget,
  channelId: string,
  config: EnablePortalConfig,
  cache: Map<string, ProductRef>,
  report: TargetReport,
): Promise<void> {
  const plans = buildPubPlans(config);
  for (const [slug, plan] of plans) {
    const product = await fetchProduct(target, slug, "default-channel", cache);
    if (!product) {
      if (plan.mode === "visible") {
        throw new Error(`Prodotto visibile "${slug}" non trovato su default-channel`);
      }
      report.steps.push(`? ${slug}: non su default-channel, skip`);
      continue;
    }
    // Brain: gotcha-stripe-channel-config / decision-012 — un protection plan
    // (AppleCare, Kyron Shield) hidden a catalogo va comunque pubblicato con
    // visibleInListings=true: il toggle "Proteggi con..." dello storefront lo
    // trova SOLO se visibile (fetchProtectionPlans), mentre il catalogo lo
    // esclude via codice. Senza questo, il toggle non compare sui portali
    // (bug Pacinotti/Pintor 2026-06-14). Lo mode "visible" fa esattamente
    // isPublished+visibleInListings+purchasable.
    const mode =
      plan.mode === "hidden-purchasable" && isProtectionSlug(slug)
        ? "visible"
        : plan.mode;
    await setVisibility(target, product.id, channelId, mode);
    for (const v of product.variants) {
      if (v.priceAmount <= 0) continue;
      if (plan.capacities && ![...plan.capacities].some((c) => variantHasCapacity(v, c))) {
        continue;
      }
      await setVariantPrice(target, v.id, channelId, v.priceAmount);
    }
    report.productsPublished += 1;
    report.steps.push(`${mode === "visible" ? "+" : "-"} ${slug}`);
  }
  // Riconciliazione rimozioni: l'enable e' DECLARATIVO. Un prodotto gia' sul
  // channel ma sparito dal piano (tolto dai commerciali via Studio) viene
  // bloccato (unpublished), altrimenti il re-seed sarebbe solo additivo e i
  // prodotti rimossi resterebbero in vendita.
  const onChannel = await listChannelProductSlugs(target, config.slug);
  for (const slug of onChannel) {
    if (plans.has(slug)) continue;
    const product = await fetchProduct(target, slug, "default-channel", cache);
    if (!product) continue;
    await setVisibility(target, product.id, channelId, "hidden-blocked");
    report.steps.push(`x ${slug} (rimosso dal portale)`);
  }
}

// Port di step3b: kind:eur = prezzo FINALE -> Promotion FIXED su listino pieno
// (barrato in storefront); kind:percent = Promotion PERCENTAGE per-variante.
async function applyDiscounts(
  target: SaleorTarget,
  channelId: string,
  config: EnablePortalConfig,
  cache: Map<string, ProductRef>,
  report: TargetReport,
): Promise<void> {
  for (const d of config.catalog.productDiscounts) {
    const product = await fetchProduct(target, d.slug, "default-channel", cache);
    if (!product) throw new Error(`productDiscount: "${d.slug}" non trovato`);
    const variants = d.capacity
      ? product.variants.filter((v) => variantHasCapacity(v, d.capacity!))
      : product.variants;
    if (variants.length === 0) {
      throw new Error(`productDiscount ${d.slug}: nessuna variante per ${d.capacity}`);
    }
    const tag = d.capacity ? `${d.slug}-${d.capacity}` : d.slug;
    if (d.kind === "eur") {
      if (!d.capacity && variants.length !== 1) {
        throw new Error(`productDiscount ${d.slug} eur su multivariante senza capacity`);
      }
      const listini = new Set(variants.map((v) => v.undiscountedAmount));
      if (listini.size !== 1) {
        throw new Error(`productDiscount ${d.slug}: listini divergenti tra SKU target`);
      }
      const listino = variants[0].undiscountedAmount;
      const off = Math.round((listino - d.value) * 100) / 100;
      if (off <= 0) {
        throw new Error(`productDiscount ${d.slug}: finale ${d.value} >= listino ${listino}`);
      }
      for (const v of variants) await setVariantPrice(target, v.id, channelId, listino);
      await upsertPromotion(target, {
        name: `Kyron ${config.slug} ${tag} ${d.value}EUR`,
        ruleName: `${tag} -${off}EUR`,
        rewardValueType: "FIXED",
        rewardValue: off,
        variantIds: variants.map((v) => v.id),
        channelId,
      });
      report.steps.push(`promo eur: ${tag} ${listino} -> ${d.value}`);
    } else {
      await upsertPromotion(target, {
        name: `Kyron ${config.slug} ${tag} -${d.value}%`,
        ruleName: `${tag} -${d.value}%`,
        rewardValueType: "PERCENTAGE",
        rewardValue: d.value,
        variantIds: variants.map((v) => v.id),
        channelId,
      });
      report.steps.push(`promo percent: ${tag} -${d.value}%`);
    }
    report.promotionsApplied += 1;
  }
}

async function applyVouchers(
  target: SaleorTarget,
  channelId: string,
  config: EnablePortalConfig,
  cache: Map<string, ProductRef>,
  report: TargetReport,
): Promise<void> {
  for (const bundle of config.bundles) {
    const saving = await resolveBundleSaving(target, bundle, cache);
    const code = voucherCodeFor(config.slug, bundle.slug);
    const id = await ensureVoucher(target, {
      channelId,
      code,
      name: `Bundle ${config.nome} ${bundle.slug.toUpperCase()}`,
      discountEur: saving,
    });
    report.vouchers[bundle.slug] = id;
    report.steps.push(`voucher ${code} -${saving}EUR`);
  }
}

// Poll pubblico: il beat Saleor applica le Promotion entro minuti, ma non
// sempre (visto 2026-06-12 su staging). Best-effort: ~75s, poi onSale=false
// viene riportato e l'operatore sa che serve il recalc manuale.
async function pollPromotionsOnSale(
  target: SaleorTarget,
  channelSlug: string,
  config: EnablePortalConfig,
): Promise<boolean> {
  const probe = config.catalog.productDiscounts[0];
  if (!probe) return true;
  const query = `query ($slug: String!, $channel: String!) {
    product(slug: $slug, channel: $channel) { variants { pricing { onSale } } }
  }`;
  for (let attempt = 0; attempt < 15; attempt++) {
    const res = await fetch(saleorUrlFor(target), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { slug: probe.slug, channel: channelSlug } }),
    });
    if (res.ok) {
      const json = (await res.json()) as {
        data?: { product?: { variants: Array<{ pricing: { onSale: boolean } | null }> } };
      };
      const onSale = json.data?.product?.variants.some((v) => v.pricing?.onSale);
      if (onSale) return true;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function enableOnTarget(
  config: EnablePortalConfig,
  target: SaleorTarget,
): Promise<TargetReport> {
  const report: TargetReport = {
    target,
    channelId: "",
    channelCreated: false,
    productsPublished: 0,
    promotionsApplied: 0,
    vouchers: {},
    promotionsOnSale: null,
    steps: [],
  };
  const cache = new Map<string, ProductRef>();
  const channel = await ensureChannel(target, config.slug, config.nome);
  report.channelId = channel.id;
  report.channelCreated = channel.created;
  await ensureShipping(target, channel.id, config.shippingMethodLabel, config.shippingPriceEur);
  await applyVisibilityAndPricing(target, channel.id, config, cache, report);
  await applyDiscounts(target, channel.id, config, cache, report);
  await applyVouchers(target, channel.id, config, cache, report);
  if (config.catalog.productDiscounts.length > 0) {
    report.promotionsOnSale = await pollPromotionsOnSale(target, config.slug, config);
  }
  return report;
}

async function markOnboarded(
  portal: PortalDetail,
  channelId: string,
  config: EnablePortalConfig,
): Promise<boolean> {
  const doc = await findPortalDoc(portal.slug);
  if (!doc) return false;
  const gw = getPortalsGateway();
  // Persiste anche il catalogo/bundles NORMALIZZATI: il doc Payload guarisce
  // (i doc storici pre-Fase A avevano SKU minuscoli, protection plan visibili,
  // visibleVariants contraddittori) e resta allineato a cio' che e' su Saleor.
  await gw.update(PORTALS_COLLECTION, String(doc.id), {
    status: "onboarded",
    channelId,
    catalog: config.catalog,
    bundles: config.bundles,
  });
  return true;
}

export async function enablePortal(
  slug: string,
  targets: SaleorTarget[] = ["staging", "prod"],
): Promise<EnableReport> {
  const portal = await getPortal(slug);
  if (!portal) throw new Error(`Portale "${slug}" non trovato`);
  const parsed = toEnableConfig(portal);
  // Normalizzazione pre-enable: i doc Payload storici (o modificati a mano)
  // possono avere il catalogo non corretto (SKU minuscoli, protection plan
  // visibili, visibleVariants vs heroOutsideBundle). Stesse regole del save
  // dell'agente; gli errori bloccano PRIMA di toccare Saleor.
  const normalized = await normalizePendingSchool({
    catalog: { ...parsed.catalog, productDiscounts: parsed.catalog.productDiscounts },
    bundles: parsed.bundles,
  });
  if (normalized.errors.length > 0) {
    throw new Error(`Descriptor non valido: ${normalized.errors.join(" | ")}`);
  }
  const config: EnablePortalConfig = {
    ...parsed,
    catalog: { ...parsed.catalog, ...normalized.doc.catalog },
    bundles: normalized.doc.bundles as EnablePortalConfig["bundles"],
  };
  const reports: TargetReport[] = [];
  for (const target of targets) {
    reports.push(await enableOnTarget(config, target));
  }
  // staging e prod sono cloni DB SEPARATI: un channel nuovo prende PK
  // indipendenti su ogni env, quindi i channelId DIVERGONO (atteso, non un
  // errore — bloccava il go-live dei portali nati runtime). Lo storefront usa
  // lo SLUG ovunque tranne la pagina "i miei ordini" (filtro per channelId) e
  // la config Stripe via kyron-ops, entrambe sul live: salviamo l'id di PROD.
  // (staging e' solo smoke test). Brain: enable-channelid-diverges-staging-prod.
  const ids = new Set(reports.map((r) => r.channelId));
  if (ids.size > 1) {
    console.warn(
      `[enable] channelId divergenti (atteso, cloni separati): ${reports
        .map((r) => `${r.target}=${r.channelId}`)
        .join(", ")} — salvo l'id di prod`,
    );
  }
  const channelId =
    (reports.find((r) => r.target === "prod") ?? reports[0])?.channelId ?? "";
  // portal.status e' il valore PRE-enable (markOnboarded aggiorna Payload, non
  // l'oggetto in memoria): lo usiamo come "primo go-live".
  const firstGoLive = portal.status !== "onboarded";
  const payloadUpdated = await markOnboarded(portal, channelId, config);

  // decision-020: kyron-ops chiude il cerchio dell'onboarding self-service.
  // Recalc SOLO se ci sono sconti (i kit a voucher non ne hanno bisogno); Stripe
  // config SOLO al primo go-live. Best-effort: errori non rompono l'enable.
  const ops: EnableReport["ops"] = {};
  if (config.catalog.productDiscounts.length > 0) {
    ops.recalc = await opsRecalc();
  }
  if (firstGoLive && channelId) {
    ops.stripe = await opsAssignStripe(channelId);
  }

  return {
    slug,
    targets: reports,
    payloadUpdated,
    normalizationFixes: normalized.fixes,
    ops,
  };
}
