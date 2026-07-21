---
type: gotcha
project: studio-server
created: 2026-07-21
last_verified: 2026-07-21
tags: [saleor, orders, order-line, unconfirmed, money-path, voucher, discount, studio]
---
# Editing righe ordine Saleor: solo UNCONFIRMED + re-adjust del totale scontato

**Trigger**: implementare/estendere la modifica delle righe di un ordine (quantità,
cambio colore/variante, cambio prodotto) dal backoffice Studio; oppure un
`orderLineUpdate`/`orderLinesAdd`/`orderLineDelete` che torna *"Only draft and
unconfirmed order can be modified"* o che manda in vacca il totale.

## Il vincolo

In **Saleor 3.23** le mutation order-line (`orderLineUpdate`, `orderLineDelete`,
`orderLinesAdd`, `orderLineDiscount*`) e le `orderDiscount*` operano **solo su ordini
`DRAFT` o `UNCONFIRMED`**. Un ordine **confermato** (`UNFULFILLED`/`FULFILLED`) le
rifiuta. Gli ordini offline dei portali (bonifico / Carta del Docente) nascono
`UNCONFIRMED` (channel `allowUnpaidOrders`) e restano tali finché non evasi → **quella
è l'unica finestra in cui si può editare una riga**. Su ordini confermati la modifica
va **annotata per Danea** (campo Note / override IVA), non applicata su Saleor.

## Perché toccare una riga "rompe" il totale

Gli ordini kit hanno un totale forzato: voucher bundle FIXED + sconto MANUALE
(`orderDiscountAdd`) che convivono, col totale esatto tenuto da
`forceOrderTotalViaDiscount` (misura-e-correggi). Vedi
`ecommerce/.../gotcha-bonifico-discount-evicts-bundle-voucher.md`. Qualsiasi edit di
riga **fa ricalcolare** il totale a Saleor: il residuo del voucher bundle cambia e il
target salta.

## Cosa fare (money-path)

Dopo ogni edit di riga, **ri-forzare il totale commerciale atteso**:
- riusa lo sconto **MANUALE già presente** (`discounts.type === "MANUAL"`, es. bonifico)
  con `orderDiscountUpdate` — **non** aggiungerne un secondo (si impilerebbero);
- se non c'è, aggiungilo con `orderDiscountAdd`;
- misura il totale reale e correggi l'importo (max 2 iterazioni: il residuo del voucher
  è costante → converge);
- **MAI rimuovere il voucher bundle**: senza voucher l'ordine (channel con
  `automatically_confirm_all_new_orders`) **auto-conferma** e non è più editabile;
- errori **non silenziosi** (è money-path).

Implementazione: `studio-server/src/core/saleor/order-edit.ts` (`changeLineVariant`,
`updateLineQuantity`, `readjustTotal`). Endpoint `POST /api/v1/orders/line` gated su
`UNCONFIRMED`; il frontend (`EditableLines`) mostra i controlli solo se editabile.

**Cambio colore** = altra variante stessa capacità: naviga le varianti sorelle
(attributi `capacita`/`colore`) e usa `orderLinesCreate`+`orderLineDelete` (lo swap
in-place non esiste); il colore non cambia prezzo → target = totale pre-edit.

Due dettagli **verificati su draft prod** (2026-07-21):
- La mutation è **`orderLinesCreate`**, NON `orderLinesAdd` (che non esiste in 3.23 →
  400 "Cannot query field orderLinesAdd").
- **Aggiungi PRIMA, cancella DOPO**: se fai delete e poi l'add fallisce, la riga è
  persa e l'ordine resta a 0 righe (successo su money-path reale). Add-prima-di-delete
  lascia intatta la riga originale in caso di errore.
- Test superato: cambio colore mantiene il totale esatto (501,36 → 501,36) riusando lo
  sconto MANUALE (non ne aggiunge un secondo); cambio qty 1→2 scala il totale
  (501,36 → 1002,72) e ricalcola lo sconto (7,64 → 15,28). Validato su ordine DRAFT
  (mutation identiche a UNCONFIRMED); resta da fare uno smoke test su un ordine reale
  con **voucher bundle** (kit) per il caso voucher-collapse.

> Validare su un **ordine draft di prod** (reversibile) prima del go-live reale:
> confermare che totale scontato e voucher bundle restino corretti dopo l'edit.
