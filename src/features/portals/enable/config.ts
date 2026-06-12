// Brain: Fase B — forma canonica del portale per l'enable Saleor, derivata dal
// PortalDetail (doc Payload). I componenti bundle nel jsonb hanno selection
// discriminata ({kind:"variant"|"fixed"|"by-attribute"}): qui si normalizzano
// e si scartano forme malformate con errore esplicito (mai seed parziali).
import type { PortalDetail } from "../reader.js";

export type ComponentSelection =
  | { kind: "fixed"; variantSku: string }
  | { kind: "by-attribute"; attribute: string; valueFilter?: Record<string, string> };

export interface BundleComponentConfig {
  productSlug: string;
  selection: ComponentSelection;
}

export interface BundleConfig {
  slug: string;
  name: string;
  finalPriceEur: number;
  components: BundleComponentConfig[];
}

export interface EnablePortalConfig {
  slug: string;
  nome: string;
  shippingMethodLabel: string;
  shippingPriceEur: number;
  catalog: PortalDetail["catalog"];
  bundles: BundleConfig[];
}

function parseSelection(raw: Record<string, unknown>, ctx: string): ComponentSelection {
  const sel = raw.selection as Record<string, unknown> | undefined;
  if (!sel || typeof sel.kind !== "string") {
    throw new Error(`${ctx}: componente senza selection.kind`);
  }
  // "variant" (forma writer) e "fixed" (forma descriptor) sono la stessa cosa.
  if (sel.kind === "variant" || sel.kind === "fixed") {
    const sku = sel.variantSku;
    if (typeof sku !== "string" || !sku) {
      throw new Error(`${ctx}: selection fixed senza variantSku`);
    }
    return { kind: "fixed", variantSku: sku };
  }
  if (sel.kind === "by-attribute") {
    const attribute = typeof sel.attribute === "string" ? sel.attribute : "colore";
    const filter = sel.valueFilter;
    return {
      kind: "by-attribute",
      attribute,
      valueFilter:
        filter && typeof filter === "object"
          ? Object.fromEntries(
              Object.entries(filter as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v),
              ]),
            )
          : undefined,
    };
  }
  throw new Error(`${ctx}: selection.kind "${String(sel.kind)}" sconosciuto`);
}

export function toEnableConfig(portal: PortalDetail): EnablePortalConfig {
  return {
    slug: portal.slug,
    nome: portal.nome,
    shippingMethodLabel: portal.shippingMethodLabel || "Consegna a scuola",
    shippingPriceEur: portal.shippingPriceEur,
    catalog: portal.catalog,
    bundles: portal.bundles.map((b) => ({
      slug: b.slug,
      name: b.name,
      finalPriceEur: b.finalPriceEur,
      components: b.components.map((c, i) =>
        ((raw: Record<string, unknown>) => ({
          productSlug: String(raw.productSlug ?? ""),
          selection: parseSelection(raw, `bundle ${b.slug} comp[${i}]`),
        }))(c),
      ),
    })),
  };
}
