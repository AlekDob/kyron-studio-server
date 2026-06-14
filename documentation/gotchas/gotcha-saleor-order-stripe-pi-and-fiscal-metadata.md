---
type: gotcha
project: studio-server
created: 2026-06-14
last_verified: 2026-06-14
tags: [saleor, stripe, ordini, metadata, fiscale, ricerca]
---

# Ordine Saleor: riferimento Stripe = PaymentIntent (`pi_`), dati fiscali in `billingAddress.metadata`

Due cose non ovvie quando si leggono gli ordini Saleor per Studio (feature 008).

## 1. Stripe: si salva il PaymentIntent (`pi_`), NON il PaymentMethod (`pm_`)
Le `order.transactions[].pspReference` contengono il **PaymentIntent** Stripe (`pi_...`),
mai il PaymentMethod (`pm_...`). Quindi:
- Il link "Apri su Stripe" e la **ricerca** funzionano col `pi_` → `https://dashboard.stripe.com/payments/pi_...`.
- Cercare un `pm_` (che l'utente vede comunque in Stripe) **non dà risultati**: quel dato non
  esiste sull'ordine. Verificato su tutti gli ordini prod: 0 `pm_`, solo `pi_`.
- Le transaction **events** ripetono lo stesso `pi_` — niente `pm_` neanche lì.

## 2. Dati fiscali: in `billingAddress.metadata`, non in campi nativi
Codice fiscale, P.IVA e SDI NON sono campi Saleor: lo storefront li scrive come **metadata
dell'indirizzo di fatturazione** al checkout (Brain ecommerce `fiscal-data-checkout`,
`CheckoutForm.tsx`). Chiavi:
- `fiscalCode` — sempre presente (B2C e B2B)
- `vatNumber` — solo B2B
- `sdiCode` — solo B2B (codice destinatario)

Query: `billingAddress { companyName metadata { key value } }` e poi lookup per chiave.
`companyName` (azienda) è invece campo nativo dell'address. Verificato prod: CF tipo
`CPPNNL75B28B354C` sui B2C, vat/sdi vuoti.

Riferimento: `src/core/saleor/orders.ts` (`mapOrder`, `billingMeta`, `pspReference`).
