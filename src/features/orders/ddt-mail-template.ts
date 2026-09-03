// Riquadro dettagli di una comunicazione DDT: studente, scuola, prodotti
// consegnati. La cornice Kyron sta in `core/email/campaign-template.ts` ed e'
// condivisa con le comunicazioni ai clienti (Bea).
//
// Attenzione: questi DDT sono consegne a scuola senza tracking. Il corpo non
// deve mai parlare di spedizione o codice di tracciamento.
import type { DaneaDocument } from "@/features/commesso/danea-ddt.js";
import { detailsBox, esc, renderCampaignEmail } from "@/core/email/campaign-template.js";
import type { Campaign } from "@/core/email/campaign-template.js";

export type DdtCampaign = Campaign;
export { campaignPlainText } from "@/core/email/campaign-template.js";

/** Righe del riquadro grigio per un DDT. Vuoto = mail senza riquadro. */
export function ddtDetailsHtml(doc: DaneaDocument): string {
  // Le righe senza codice sono note di Danea ("Rif. Conferma d'ordine..."):
  // al cliente non dicono niente, si scartano.
  const items = doc.lines
    .filter((l) => l.code && l.qty > 0)
    .map((l) => `${esc(l.description)} &times; ${l.qty}`);
  return detailsBox([doc.studentNote ? esc(doc.studentNote) : "", items.join("<br>")]);
}

export function renderDdtEmail(doc: DaneaDocument, campaign: DdtCampaign): string {
  return renderCampaignEmail(campaign, ddtDetailsHtml(doc));
}
