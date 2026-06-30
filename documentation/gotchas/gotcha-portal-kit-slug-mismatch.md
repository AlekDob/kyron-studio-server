---
type: gotcha
project: studio-server
created: 2026-06-19
last_verified: 2026-06-19
tags: [portals, bundles, saleor, agent, slug, sku, enable, publish]
---
# I kit dei portali si salvano con productSlug/SKU inventati e falliscono solo al publish

## Sintomo

L'agente (chat onboarding/portali) modifica un kit con successo, ma "pubblica online"
(`enablePortal`) fallisce con:

```
Descriptor non valido: Prodotto "ipad" inesistente su Saleor (default-channel).
Slug validi: ipada16, ps-25wo1cb, muwa3zm-a, ...
```

Il portale resta editabile ma non va live: la modifica è "giusta" a video ma non butta online.

## Causa

I componenti dei bundle referenziano i prodotti **per slug**. I tool agente
`add_bundle_to_portal` / `update_bundle` (`src/features/onboard-school/agent.ts`)
**non validavano** i `productSlug` contro Saleor prima di persistere su Payload, e la
descrizione del parametro istruiva l'LLM a "usare il productSlug come SKU se non c'è
variante". Risultato: l'LLM salvava slug derivati dal NOME (`ipad`, `alimentatore`,
`apple-pencil-usb-c`) invece degli slug reali Saleor (`ipada16`, `ps-25wo1cb`,
`muwa3zm-a`). Il save passava; l'errore emergeva solo al publish, dove
`normalize.ts` (`referencedSlugs` + `fixVariantSkuCase`) valida davvero contro il catalogo.

Idem per `variantSku`: lo slug minuscolo non combacia con lo SKU reale. Attenzione al
caso `/` → `-`: lo slug `mx2d3zm-a` NON matcha lo SKU `MX2D3ZM/A` (e `fixVariantSkuCase`
corregge solo il maiuscolo/minuscolo, non la `/`).

## Trappola gemella: il nome del prodotto ≠ il codice articolo

In Saleor prod (giu 2026) il codice **`MX2D3ZM/A` è la "Apple Pencil Pro"** (slug
`mx2d3zm-a`), NON la USB-C. La **"Apple Pencil (USB-C)"** è **`MUWA3ZM/A`** (slug
`muwa3zm-a`). Chiedere un kit "Apple Pencil USB-C" col codice `MX2D3ZM/A` mette in
vendita la Pro al posto della USB-C. Verifica SEMPRE nome+SKU sul catalogo reale
(`POST https://api.kyronedu.it/graphql/`, query `products(channel:"default-channel")`,
pubblica, senza auth) prima di pubblicare.

## Fix (2026-06-19)

`validateComponentsAgainstSaleor()` in `agent.ts`: i tool bundle ora chiamano
`fetchCatalogIndex()` e rifiutano il salvataggio se un `productSlug` non esiste o se uno
`variantSku` non combacia con una variante reale, restituendo all'agente la lista degli
slug/SKU validi. La validazione del publish diventa così un check di edit-time:
fail-fast e visibile. Fail-open se Saleor è irraggiungibile (l'enable rivalida).

Descrizioni dei parametri `productSlug`/`variantSku` riscritte: slug e SKU REALI di
Saleor, mai derivati dal nome.

## Fix UI manuale (2026-06-30)

La UI `BundleCard` (`studio/src/components/portals/PortalDetail.tsx`) ricostruiva i
componenti come `{productSlug: s, variantSku: s}` ad ogni add/remove: variantSku=slug
(rotto per i multi-variante come `ipada16`) + distruggeva la `selection` dei componenti
non toccati. Era il difetto residuo che ha bloccato il re-publish di PBS
(`accademia-professionale-pbs`) al rename del kit.

Corretto:
- `studio-server` `core/saleor/client.ts` `wholeProduct()` espone `variantSku` per i
  prodotti single-variant (accessori) → la UI ha lo SKU REALE, non lo slug.
- `studio` `BundleCard`: `removeComponent` filtra e lascia gli altri componenti
  VERBATIM; `addComponent(row)` costruisce la selection canonica da `buildComponent()`
  (taglio → `by-attribute colore` + `valueFilter.capacita`; single-variant → `variant`
  + SKU reale; multi-variante senza taglio → riga disabilitata nel picker).
- tipi `BundleComponent`/`BundleComponentSelection` in `studio/src/lib/gateway.ts`.

Dati PBS regrediti (eur 4/0, `ipada16` variantSku=slug) ripristinati su Payload prod via
`studio-server/scripts/fix-pbs-descriptor.ts` (valori da
`ecommerce/documentation/schools/accademia-professionale-pbs.md`, verificati contro
Saleor prod).
