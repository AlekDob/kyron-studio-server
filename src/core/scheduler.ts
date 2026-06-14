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

// Finestra di catch-up dopo l'orario target. Il job scatta SOLO se il tick
// cade in [target, target+window). `lastRunDate` e' in-memory e si azzera a
// ogni (ri)avvio del processo: senza finestra, un container che riparte a
// meta' giornata (es. redeploy Coolify) rispedirebbe il report del giorno a
// OGNI boot -> spam. La finestra di 35' copre il catch-up legittimo (container
// su poco dopo il target) ma non trasforma un boot pomeridiano in un re-invio.
// Brain: gotcha-studio-report-catchup-spam-on-redeploy
const CATCHUP_WINDOW_MIN = 35;

// Arma un job giornaliero. Scatta una volta al giorno al primo tick dentro la
// finestra di catch-up dopo il target (Europe/Rome). In caso di errore ritenta
// al tick successivo se ancora dentro la finestra (resetta il marcatore).
export function armDailyJob(job: DailyJob): void {
  if (!job.enabled) return;
  let lastRunDate = "";
  setInterval(() => {
    const { date, hour, minute } = romeNow();
    const nowMinutes = hour * 60 + minute;
    const targetMinutes = job.hour * 60 + job.minute;
    const inWindow =
      nowMinutes >= targetMinutes &&
      nowMinutes < targetMinutes + CATCHUP_WINDOW_MIN;
    if (!inWindow || lastRunDate === date) return;
    lastRunDate = date;
    job.run().catch((err) => {
      console.error(`${job.label} failed:`, err);
      lastRunDate = ""; // ritenta al tick successivo (se ancora in finestra)
    });
  }, 30_000);
  const hh = String(job.hour).padStart(2, "0");
  const mm = String(job.minute).padStart(2, "0");
  console.log(`${job.label} armed (${hh}:${mm} Europe/Rome)`);
}
