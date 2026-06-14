---
name: kyron-read-orders
description: >-
  Leggi e conta gli ordini reali dei portali scuola Kyron da Saleor PRODUZIONE
  (api.kyronedu.it), raggruppati per portale, escludendo gli ordini di test
  interni. Usa SEMPRE questa skill quando l'utente vuole sapere quanti ordini /
  quanto fatturato ha un portale o tutti i portali, un recap/conteggio ordini
  ad-hoc (per una mail, una verifica, un confronto), "quanti ordini ha
  Pacinotti", "ordini per portale", "recap ordini", "fatturato Orsoline",
  "ordini di oggi/ieri/questa settimana sui portali", o quando una query Saleor
  `orders` standard torna 0 (e' il gotcha del token, vedi sotto). NON e' il
  report email giornaliero automatico (quella e' la feature 007 dello
  studio-server): questa skill e' per la lettura on-demand. Trigger anche solo
  "leggi gli ordini", "controlla gli ordini delle scuole", "quanto abbiamo
  venduto sul portale X".
---

# Kyron — lettura ordini portali (Saleor prod)

Leggere gli ordini veri dei portali scuola e raggrupparli per portale, su
richiesta. Fonte: Saleor **produzione** `https://api.kyronedu.it/graphql/`.

## Il gotcha che blocca tutti: serve un APP TOKEN

La query GraphQL `orders` con il login **admin staff** (`admin@example.com`)
torna **0 ordini** in produzione: quell'utente ha `restrictedAccessToChannels`,
quindi non vede nulla. Non e' un bug, e' Saleor.

Per leggere TUTTI gli ordini di TUTTI i channel serve un **App token** con
permesso `MANAGE_ORDERS` (accesso globale ai channel). E' lo **stesso token**
usato dall'export Danea (`SALEOR_APP_TOKEN`). Se ti ritrovi con "0 ordini" o un
conteggio palesemente sbagliato, quasi sempre stai usando il token sbagliato.

### Dove vive il token (mai nel repo, mai stamparlo in chiaro)

Vive nelle env Coolify di due app:

| App | uuid Coolify | Note |
|---|---|---|
| `storefront-prod` | `ztoh8hxjlget54uxsirevh26` | sorgente originale |
| `studio-server` | `x5bzjhuxbl4ab4j5tnkbckq0` | copiato per feature 007/008 |

Per leggerlo serve la Coolify API, **raggiungibile solo da dentro il server**
(porta 8000 firewallata). Chiedi all'utente il `COOLIFY_TOKEN` (scope read
basta), e **ricordagli di revocarlo** dopo. Stampa solo la presenza, non il
valore:

```bash
# elenca SOLO i nomi delle env che contengono "SALEOR" (non i valori)
ssh kyron-prod "curl -s -H 'Authorization: Bearer <COOLIFY_TOKEN>' \
  http://localhost:8000/api/v1/applications/x5bzjhuxbl4ab4j5tnkbckq0/envs \
  | python3 -c 'import sys,json;print([e[\"key\"] for e in json.load(sys.stdin) if \"SALEOR\" in e[\"key\"]])'"
```

Il modo B qui sotto **evita del tutto** di maneggiare il token: gira dentro il
container, dove il token e' gia' in `process.env`. Preferiscilo.

## Tre modi per leggere gli ordini (dal piu' semplice)

### A) Endpoint Studio gia' pronto (consigliato se hai il cookie)

Gia' arricchito con portale, agente (`requestedBy`) e codice meccanografico.

```
GET https://studio-server.kyronedu.it/api/v1/orders?from=YYYY-MM-DD&to=YYYY-MM-DD
Header:  X-Tenant: kyron
Cookie:  kyron-rev=<dal browser, loggato su Studio>
```

Codice: `studio-server/src/features/orders/route.ts` (arricchimento in
`features/orders/enrich.ts`, lettura in `core/saleor/orders.ts`).

### B) Dentro il container studio-server (nessun token da maneggiare)

E' il modo piu' pulito per un conteggio: bypassa l'auth HTTP e usa il token
gia' in env. `fetchOrdersForRange(from, to)` ritorna `OrderSummary[]`. Lo
snippet aggrega per portale (count + fatturato + ordini pagati):

```bash
ssh kyron-prod 'docker exec -i -w /app "$(docker ps --format "{{.Names}}" | grep -i x5bzjhux | head -1)" node --input-type=module -' <<'NODE'
import { fetchOrdersForRange } from "./dist/core/saleor/orders.js";
const EXCLUDE = new Set(["alekdobrohotov@gmail.com", "gmail@alekdob.com"]);
const orders = (await fetchOrdersForRange("2026-05-01", "2026-06-14"))
  .filter((o) => !EXCLUDE.has((o.userEmail || "").toLowerCase()));
const agg = {};
for (const o of orders) {
  (agg[o.channelSlug] ??= { name: o.channelName, n: 0, eur: 0, paid: 0 });
  agg[o.channelSlug].n++;
  agg[o.channelSlug].eur += o.totalGross;
  if (o.paymentStatus === "FULLY_CHARGED") agg[o.channelSlug].paid++;
}
const rows = Object.entries(agg)
  .map(([slug, a]) => ({ slug, ...a, eur: Math.round(a.eur * 100) / 100 }))
  .sort((x, y) => y.n - x.n);
console.log(JSON.stringify({ totalOrders: orders.length, rows }, null, 2));
NODE
```

Cambia le date nel range. Il container ha suffisso variabile a ogni deploy:
risolvilo sempre con `grep -i x5bzjhux | head -1`, non hardcodarlo.

### C) GraphQL Saleor diretto (se hai l'app token in mano)

```graphql
query($after: String) {
  orders(filter: { created: { gte: "2026-05-01", lte: "2026-06-14" } }, first: 100, after: $after) {
    edges { node {
      number created userEmail status paymentStatus
      channel { slug name }
      total { gross { amount currency } }
      lines { productName productSku quantity totalPrice { gross { amount } } }
    } }
    pageInfo { hasNextPage endCursor }
  }
}
```

`POST https://api.kyronedu.it/graphql/` con `Authorization: Bearer <APP_TOKEN>`.
Pagina finche' `pageInfo.hasNextPage`. `created` e' un range di sole date
(YYYY-MM-DD), filtro per giorno UTC.

## Escludi sempre gli ordini di test

Gli smoke test del checkout in produzione vanno **filtrati per email cliente**:

```
alekdobrohotov@gmail.com
gmail@alekdob.com
```

E' la stessa lista `DEFAULT_EXCLUDE` di
`studio-server/src/features/orders-report/report.ts` (env override:
`ORDERS_REPORT_EXCLUDE_EMAILS`). Se l'utente chiede "ordini veri" o un recap da
mandare, escludili sempre. Se chiede esplicitamente "inclusi i test", non
filtrare e dillo.

## channel.slug = portale

Lo slug del channel Saleor coincide con lo slug del tenant/portale (registry
`ecommerce/storefront/src/lib/tenants.ts`). Mappa per dare nomi leggibili:

| channel.slug | Portale |
|---|---|
| `orsoline-san-carlo` | Orsoline di San Carlo |
| `liceo-scientifico-statale-antonio-pacinotti` | Liceo Scientifico Pacinotti |
| `liceo-classico-giovanni-siotto-pintor` | Liceo Classico Siotto Pintor |
| `accademia-professionale-pbs` | Accademia Professionale PBS |
| `ic-massari-galilei` | I.C. Massari - Galilei |
| `scuola-demo` | **Kyron Shop (main shop, NON un portale scuola)** |

Quando presenti un recap "per portale", tieni `scuola-demo` separato (e'
la vetrina pubblica), non sommarlo ai portali scuola senza dirlo.

## Shape di OrderSummary

Da `studio-server/src/core/saleor/orders.ts` (modo B):

```
number, created, channelSlug, channelName, userEmail,
totalGross, currency, status, paymentStatus,
lines: [{ sku, name, quantity, totalGross }]
```

`paymentStatus === "FULLY_CHARGED"` = ordine pagato. `status` e' lo stato di
evasione (UNFULFILLED / FULFILLED / CANCELED...).

## Skill e riferimenti correlati

- **danea-order-export** (`ecommerce/.claude/skills/`) — stesso app token, export
  ordini verso Danea Easyfatt.
- **kyron-ecommerce-ops** (`ecommerce/.claude/skills/`) — meccaniche Saleor admin
  + Coolify API (token, deploy, env).
- **studio-server feature 007** — report email ordini giornaliero (09:30), usa
  `fetchOrdersForDay`. **feature 008** — `GET /api/v1/orders` (il modo A).
- Gotcha redeploy/report: `studio-server/documentation/gotchas/gotcha-studio-report-catchup-spam-on-redeploy.md`.
