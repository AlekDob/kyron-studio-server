import { describe, it, expect, vi, afterEach } from "vitest";
import { armDailyJob } from "@/core/scheduler.js";

// Il doppione del 2026-08-28: report gia' inviato alle 08:45, redeploy alle
// 08:58 -> il nuovo processo rispediva perche' era ancora dentro la finestra
// di catch-up. Un processo nato dopo il target non deve piu' recuperare.
function armAt(clock: string, target: { hour: number; minute: number }) {
  vi.setSystemTime(new Date(`2026-08-28T${clock}:00+02:00`));
  const run = vi.fn().mockResolvedValue(undefined);
  armDailyJob({ enabled: true, ...target, label: "test", run });
  vi.advanceTimersByTime(60_000);
  return run;
}

describe("armDailyJob", () => {
  afterEach(() => vi.useRealTimers());

  it("non recupera se il processo nasce dopo l'orario target", () => {
    vi.useFakeTimers();
    expect(armAt("08:58", { hour: 8, minute: 45 })).not.toHaveBeenCalled();
  });

  it("gira comunque se il processo era gia' su prima del target", () => {
    vi.useFakeTimers();
    expect(armAt("08:44", { hour: 8, minute: 45 })).toHaveBeenCalledTimes(1);
  });
});
