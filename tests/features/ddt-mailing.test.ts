import { afterEach, describe, expect, it } from "vitest";
import { allowlistFromEnv, passesAllowlist } from "@/core/email/bulk.js";
import { logKey } from "@/features/orders/email-log.js";
import { sendDdtMailing, sendDdtTestMail } from "@/features/orders/ddt-mailing.js";

afterEach(() => {
  delete process.env.DDT_MAIL_ALLOW;
  delete process.env.DDT_MAIL_ENABLED;
});

describe("guardie invio comunicazioni", () => {
  // Allowlist piena = solo quegli indirizzi; vuota = tutti (go-live).
  it("allowlist vuota lascia passare tutti", () => {
    expect(allowlistFromEnv("DDT_MAIL_ALLOW")).toEqual([]);
    expect(passesAllowlist("chiunque@example.it", [])).toBe(true);
  });

  it("allowlist piena blocca chi non c'e', case-insensitive", () => {
    process.env.DDT_MAIL_ALLOW = " Gmail@alekdob.com , team@kyronedu.it ";
    const allow = allowlistFromEnv("DDT_MAIL_ALLOW");
    expect(allow).toEqual(["gmail@alekdob.com", "team@kyronedu.it"]);
    expect(passesAllowlist("GMAIL@Alekdob.com", allow)).toBe(true);
    expect(passesAllowlist("cliente@example.it", allow)).toBe(false);
  });

  // Senza la variable esplicita non deve partire NIENTE, nemmeno con un piano valido.
  it("senza DDT_MAIL_ENABLED l'invio si rifiuta", async () => {
    await expect(
      sendDdtMailing({
        importId: "dan_x",
        campaignId: "test",
        campaign: { subject: "s", heading: "h", paragraphs: ["p"] },
      }),
    ).rejects.toThrow(/DDT_MAIL_ENABLED/);
  });

  // La chiave e' per campagna: la stessa consegna in due comunicazioni diverse
  // deve poter partire due volte.
  it("la chiave di idempotenza include la campagna", () => {
    expect(logKey("ritardi-agosto", "/EC-1-2026-08-05")).toBe("ritardi-agosto:/EC-1-2026-08-05");
    expect(logKey("a", "k")).not.toBe(logKey("b", "k"));
  });

  // La prova salta DDT_MAIL_ENABLED e l'allowlist: l'indirizzo e' il solo
  // confine rimasto, quindi deve reggere. Un indirizzo per chiamata.
  it("la mail di prova rifiuta un destinatario non valido", async () => {
    const bad = ["", "  ", "non-una-mail", "a@b.it, c@d.it"];
    for (const to of bad) {
      await expect(
        sendDdtTestMail({
          importId: "dan_x",
          campaignId: "test",
          campaign: { subject: "s", heading: "h", paragraphs: ["p"] },
          previewIndex: 0,
          to,
        }),
      ).rejects.toThrow(/non valido/);
    }
  });
});
