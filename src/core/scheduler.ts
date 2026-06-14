// Scheduler in-process per i job giornalieri di Studio (report email).
// Niente cron esterno: il job vive col processo Hono. Tick ogni 30s, esegue una
// volta al giorno al primo tick raggiunto l'orario target in Europe/Rome
// (catch-up incluso se il container riparte piu' tardi nello stesso giorno).
// DST-proof via Intl.

// Data (YYYY-MM-DD), ora e minuti correnti in Europe/Rome.
export function romeNow(): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

// Ieri in Europe/Rome: data YYYY-MM-DD (per i filtri) e label italiana leggibile.
export function romeYesterday(): { date: string; label: string } {
  const d = new Date(Date.now() - 86_400_000);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const label = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  return { date, label };
}

export interface DailyJob {
  enabled: boolean;
  hour: number;
  minute: number;
  label: string;
  run: () => Promise<void>;
}

// Arma un job giornaliero. Scatta una volta al giorno al primo tick in cui
// l'orario Europe/Rome ha raggiunto/superato il target. In caso di errore
// ritenta al tick successivo (resetta il marcatore del giorno).
export function armDailyJob(job: DailyJob): void {
  if (!job.enabled) return;
  let lastRunDate = "";
  setInterval(() => {
    const { date, hour, minute } = romeNow();
    const reached =
      hour > job.hour || (hour === job.hour && minute >= job.minute);
    if (!reached || lastRunDate === date) return;
    lastRunDate = date;
    job.run().catch((err) => {
      console.error(`${job.label} failed:`, err);
      lastRunDate = ""; // ritenta al tick successivo
    });
  }, 30_000);
  const hh = String(job.hour).padStart(2, "0");
  const mm = String(job.minute).padStart(2, "0");
  console.log(`${job.label} armed (${hh}:${mm} Europe/Rome)`);
}
