// Price Guard — orchestrazione: esegue il check, e SE ci sono anomalie manda
// una mail al team. Nessuna mail se tutto ok (opt-out via PRICE_GUARD_ALWAYS_SEND).
// Scheduler in-process opt-in (PRICE_GUARD_ENABLED), stesso pattern dei report
// ordini/analytics. Solo lettura: non tocca Saleor/Payload.
import { runPriceGuard, type Anomaly } from "./check.js";
import { renderPriceGuardHtml } from "./render.js";
import { sendKyronEmail, recipientsFromEnv } from "@/core/email/mailer.js";
import { armDailyJob, romeYesterday } from "@/core/scheduler.js";

const DEFAULT_TO = "team@kyronedu.it,gmail@alekdob.com";

// Esegue il check e invia la mail solo se ci sono anomalie. Ritorna le anomalie
// (usato anche dall'endpoint manuale e dai test). Digest del giorno prima: gli
// ordini elencati sono quelli di IERI (la configurazione controllata e' quella
// attuale — un kit o e' mal configurato adesso, o non lo e').
export async function runAndNotify(): Promise<Anomaly[]> {
  const { date, label } = romeYesterday();
  const anomalies = await runPriceGuard({ ordersFrom: date });
  const always = process.env.PRICE_GUARD_ALWAYS_SEND === "true";
  if (anomalies.length === 0 && !always) {
    console.log("[price-guard] nessuna anomalia, nessuna mail");
    return anomalies;
  }
  const subject =
    anomalies.length === 0
      ? `Controllo prezzi — ${label}: tutto ok`
      : `Controllo prezzi — ${label}: ${anomalies.length} anomali${anomalies.length === 1 ? "a" : "e"}`;
  const html = renderPriceGuardHtml(anomalies, label);
  await sendKyronEmail(subject, html, recipientsFromEnv("PRICE_GUARD_TO", DEFAULT_TO));
  return anomalies;
}

// Opt-in via PRICE_GUARD_ENABLED. Gira alle 08:45 Europe/Rome, poco prima dei
// report analytics (09:00) e ordini (09:30): se qualcosa non torna sui prezzi,
// lo sai prima di guardare gli ordini del giorno. Armato in index.ts.
export function armDailyPriceGuard(): void {
  armDailyJob({
    enabled: process.env.PRICE_GUARD_ENABLED === "true",
    hour: 8,
    minute: 45,
    label: "price guard daily check",
    run: async () => {
      await runAndNotify();
    },
  });
}
