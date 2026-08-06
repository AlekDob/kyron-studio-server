---
type: gotcha
project: studio-server
created: 2026-06-22
last_verified: 2026-06-22
tags: [portals, catalog, visibleSlugs, hiddenSlugs, enable, saleor, agent, discount, productDiscount]
---
# Prodotto in `hiddenSlugs`: lo sconto si salva ma il prodotto resta fuori dal catalogo

## Sintomo

Cliente chiede "aggiungimi il prodotto X a Y€ al portale". L'agente Studio dice di
averlo fatto, lo `productDiscount` (es. `eur` 30) **compare nel record** `pending-schools`,
ma sullo shop il prodotto **non appare** (`products(channel:"<slug>")` non lo elenca).
"Le altre modifiche le fa giuste, questa no."

## Causa

Nel modello portale ci sono **due liste** in `catalog`:

| Lista | Mode all'enable (`enable.ts`) | Effetto Saleor |
|---|---|---|
| `visibleSlugs` | `visible` | `isPublished + visibleInListings + isAvailableForPurchase` → **in vetrina** |
| `hiddenSlugs` | `hidden-purchasable` | `visibleInListings:false` → acquistabile via link, **NON in catalogo** |

Lo `productDiscount` è indipendente dalla visibilità: si applica allo slug
ovunque sia. Quindi un prodotto può avere il prezzo corretto **ed essere in
`hiddenSlugs`** → sconto giusto, prodotto invisibile. Inoltre se il record viene
modificato senza un `apply_to_saleor`/`enablePortal` successivo, la modifica non
arriva mai a Saleor.

Combo con `gotcha-portal-kit-slug-mismatch`: lo slug è la **SKU Danea** (es. Wacebo
Dabliu Pencil = `dbp01-a35ri`, non `wacebo-dabliu-pencil`), che l'LLM indovina
sbagliato → `update_discounts` ritorna "non trovato" ma l'agente dichiara successo.

## Fix

1. Sposta lo slug da `hiddenSlugs` a `visibleSlugs` (preservando `productDiscounts`):
   ```js
   import { patchPortalCatalog } from "/app/dist/features/portals/writer.js";
   await patchPortalCatalog("<slug>", { visibleSlugs: [...], hiddenSlugs: [...] });
   ```
   `patchPortalCatalog` fa merge: i campi non passati (productDiscounts, visibleVariants) restano.
2. Ri-applica: `enablePortal("<slug>")` (default staging+prod). Per `eur` su variante
   singola: setta prezzo variante = listino + Promotion `FIXED` per la differenza, poi
   lancia il recalc Saleor (necessario perché lo sconto è una Promotion).

## Diagnosi rapida (read-only)

```bash
# stato record portale (slug + liste + sconti)
ssh kyron-prod 'docker exec <studio-server> node -e "..."  # GET /pending-schools?where[slug][equals]=<slug>
# cosa è davvero pubblicato sul channel
curl -s -X POST https://api.kyronedu.it/graphql/ -d "{\"query\":\"{products(first:20,channel:\\\"<slug>\\\"){edges{node{slug pricing{priceRange{start{gross{amount}}}}}}}}\"}"
```

## Prevenzione (TODO codice)

Quando l'agente aggiunge un prodotto richiesto dal cliente dovrebbe metterlo in
`visibleSlugs` (non hidden) e risolvere nome→slug in modo deterministico prima di
chiamare `update_discounts`/`update_catalog`, evitando lo slug indovinato.

## Riferimenti

- `studio-server/src/features/portals/enable/enable.ts` (merge visible/hidden, applyDiscounts)
- `studio-server/src/features/portals/writer.ts` `patchPortalCatalog`
- Gotcha correlato: `gotcha-portal-kit-slug-mismatch.md`
- Caso reale: portale `rodari`, Wacebo Dabliu Pencil `dbp01-a35ri` a 30€ (2026-06-22)
