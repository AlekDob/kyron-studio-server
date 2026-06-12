// Test live della mail "nuovo portale online" (Fase B/5 pipeline onboarding).
// Costruisce il PortalDetail del Siotto Pintor con i dati REALI del go-live
// 2026-06-12 (channel Q2hhbm5lbDo3, voucher Vm91Y2hlcjo3/8) senza passare da
// Payload (la API key locale non vale su prod) e invia via Resend.
//
// Uso: RESEND_API_KEY=<key> npx tsx scripts/send-portal-live-test.ts
// Destinatari: PORTAL_LIVE_NOTIFY_TO (default info@kyronedu.it,gmail@alekdob.com)
import { sendPortalLiveEmail } from "../src/features/portals/enable/notify.js";
import type { EnableReport } from "../src/features/portals/enable/enable.js";

const portal = {
  slug: "liceo-classico-giovanni-siotto-pintor",
  nome: "Liceo Classico Giovanni Siotto Pintor",
  branding: {
    nome: "Liceo Classico Giovanni Siotto Pintor",
    // Logo servito dallo storefront prod (asset shippato col portale).
    logoUrl:
      "https://kyronedu.it/shop/tenants/liceo-classico-giovanni-siotto-pintor/logo.png",
  },
  catalog: {
    visibleSlugs: ["ps-25wo1cb", "coverone", "dbp01-a35ri"],
    visibleVariants: [],
    hiddenSlugs: ["ipada16", "applecare-plus-ipad-a16"],
    productDiscounts: [
      { slug: "applecare-plus-ipad-a16", capacity: null, kind: "eur" as const, value: 75 },
    ],
    heroOutsideBundle: false,
    accessoriesOutsideBundle: true,
  },
  bundles: [
    { slug: "bundle-ipad-128gb", name: "BUNDLE iPad 128GB", finalPriceEur: 435, components: [] },
    { slug: "bundle-ipad-256gb", name: "BUNDLE iPad 256GB", finalPriceEur: 560, components: [] },
  ],
};

const report: EnableReport = {
  slug: portal.slug,
  payloadUpdated: true,
  normalizationFixes: [],
  targets: (["staging", "prod"] as const).map((target) => ({
    target,
    channelId: "Q2hhbm5lbDo3",
    channelCreated: false,
    productsPublished: 5,
    promotionsApplied: 1,
    vouchers: {
      "bundle-ipad-128gb": "Vm91Y2hlcjo3",
      "bundle-ipad-256gb": "Vm91Y2hlcjo4",
    },
    promotionsOnSale: true,
    steps: [],
  })),
};

const ok = await sendPortalLiveEmail(portal, report);
console.log(ok ? "Email inviata." : "Invio FALLITO (RESEND_API_KEY mancante o errore API).");
process.exit(ok ? 0 : 1);
