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

## Da fare ancora

La UI manuale `BundleCard` (`studio/src/components/portals/PortalDetail.tsx`,
`addComponent`/`removeComponent`) ricostruisce i componenti come `{productSlug: s,
variantSku: s}`, riproducendo lo stesso difetto + distruggendo la `selection` dei
componenti non toccati. Va corretta lato client (preservare i componenti esistenti +
risolvere lo SKU reale dal catalogo).
