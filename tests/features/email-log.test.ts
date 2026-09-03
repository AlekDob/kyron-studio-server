import { describe, it, expect } from "vitest";
import { htmlToText } from "@/features/orders/email-log.js";

// Il body salvato nel log e' quello che l'operatore legge nella scheda ordine:
// se lo strip lascia passare style/markup, la sezione Comunicazioni e' illeggibile.
describe("htmlToText", () => {
  it("tiene il testo e butta head, style e tag", () => {
    const html = `<html><head><style>.a{color:red}</style></head>
      <body><p>Ciao, il tuo ordine <strong>#508</strong> &egrave; stato spedito.</p>
      <p>&mdash; Il team Kyron</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain("Ciao, il tuo ordine #508 e stato spedito.");
    expect(text).toContain("Il team Kyron");
    expect(text).not.toMatch(/[<>]|color:red/);
  });
});

import { audienceOf, matchesOrder, type ResendEmail } from "@/features/orders/resend-log.js";

const mail = (subject: string, to: string[]): ResendEmail => ({
  id: "x",
  to,
  subject,
  sentAt: "2026-08-28T15:06:00Z",
  lastEvent: "delivered",
});

// Il match sbagliato qui mostrerebbe all'operatore le mail di un ALTRO ordine.
describe("matchesOrder", () => {
  it("aggancia per numero nell'oggetto", () => {
    expect(matchesOrder(mail("Ordine #504 confermato — Kyron", ["a@b.it"]), "504")).toBe(true);
  });

  it("non confonde #504 con #5041", () => {
    expect(matchesOrder(mail("Ordine #5041 confermato", ["a@b.it"]), "504")).toBe(false);
  });

  it("aggancia per email cliente anche senza numero", () => {
    const m = mail("Buono Carta del Docente — ordine da confermare", ["ordini@kyronedu.it"]);
    expect(matchesOrder(m, "504", "ORDINI@kyronedu.it")).toBe(true);
    expect(matchesOrder(m, "504", "altro@cliente.it")).toBe(false);
    expect(matchesOrder(m, "504")).toBe(false);
  });
});

// Etichettare "al cliente" una mail interna farebbe dire all'operatore
// "gliel'abbiamo scritto" quando il cliente non ha ricevuto niente.
describe("audienceOf", () => {
  it("cliente se tra i destinatari c'e' l'email dell'ordine", () => {
    expect(audienceOf(["walter@gmail.com"], "walter@gmail.com")).toBe("cliente");
    expect(audienceOf(["ordini@kyronedu.it", "gmail@alekdob.com"], "walter@gmail.com")).toBe(
      "interna",
    );
  });

  it("senza email dell'ordine si regola sul dominio", () => {
    expect(audienceOf(["ordini@kyronedu.it"])).toBe("interna");
    expect(audienceOf(["walter@gmail.com"])).toBe("cliente");
    // Agente commerciale esterno in copia: non e' solo roba nostra.
    expect(audienceOf(["ordini@kyronedu.it", "agente@fuori.it"])).toBe("cliente");
  });
});
