// Report ordini giornaliero: gli ordini di IERI da Saleor prod, raggruppati per
// portale, inviati via email alle 09:30 Europe/Rome. Esclude gli ordini di test
// interni (lista email configurabile). Brain: pattern report analytics 09:00.
import { fetchOrdersForDay } from "@/core/saleor/orders.js";
import { sendKyronEmail, recipientsFromEnv } from "@/core/email/mailer.js";
import { armDailyJob, romeYesterday } from "@/core/scheduler.js";
import { groupByPortal, renderOrdersHtml } from "./render.js";

const DEFAULT_TO = "team@kyronedu.it,gmail@alekdob.com";
// Email degli smoke test del checkout in produzione: escluse dal report.
const DEFAULT_EXCLUDE = "alekdobrohotov@gmail.com,gmail@alekdob.com";

function excludedEmails(): Set<string> {
  return new Set(
    (process.env.ORDERS_REPORT_EXCLUDE_EMAILS ?? DEFAULT_EXCLUDE)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function sendDailyOrdersReport(): Promise<void> {
  const { date, label } = romeYesterday();
  const excluded = excludedEmails();
  const orders = (await fetchOrdersForDay(date)).filter(
    (o) => !excluded.has(o.userEmail.toLowerCase()),
  );
  const n = orders.length;
  const subject =
    n === 0
      ? `Ordini Kyron — ${label}: nessun ordine`
      : `Ordini Kyron — ${label}: ${n} ordin${n === 1 ? "e" : "i"}`;
  const html = renderOrdersHtml(groupByPortal(orders), label);
  await sendKyronEmail(subject, html, recipientsFromEnv("ORDERS_REPORT_TO", DEFAULT_TO));
}

// Opt-in via ORDERS_REPORT_ENABLED. Armato in index.ts.
export function armDailyOrdersReport(): void {
  armDailyJob({
    enabled: process.env.ORDERS_REPORT_ENABLED === "true",
    hour: 9,
    minute: 30,
    label: "orders daily report",
    run: sendDailyOrdersReport,
  });
}
