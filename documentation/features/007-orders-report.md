---
type: feature
project: studio-server
created: 2026-06-14
status: shipped
tags: [orders, report, email, saleor, resend, scheduler]
---

# Feature 007 — Report ordini giornaliero via email

Email automatica ogni mattina alle **09:30 Europe/Rome** con gli ordini di **ieri**
da Saleor **produzione**, raggruppati **per portale**, con dettaglio prodotto
(codice SKU + descrizione + quantita + prezzo) e totale per ordine. Companion del
report analytics delle 09:00 (feature 005). Brain: decision-017 (report email), skill kyron-email.

## Cosa fa

| | |
|---|---|
| Quando | 09:30 Europe/Rome, ogni giorno (scheduler in-process) |
| Cosa | Ordini di ieri, raggruppati per portale (channel Saleor) |
| Dettaglio | Per ordine: cliente, righe `Cod. SKU + descrizione x qty + prezzo`, totale |
| Esclusioni | Ordini di test interni (email in `ORDERS_REPORT_EXCLUDE_EMAILS`) |
| Giorni a zero | Invia comunque "nessun ordine" |
| Destinatari | `ORDERS_REPORT_TO` (default `team@kyronedu.it,gmail@alekdob.com`) |
| Canale | Resend, mittente `Kyron <web@kyronedu.it>`, logo inline cid |

## File

| File | Ruolo |
|---|---|
| `src/core/saleor/orders.ts` | `fetchOrdersForDay(date)` — query GraphQL `orders` autenticata (app token), paginata, mappata in `OrderSummary[]` |
| `src/features/orders-report/render.ts` | `groupByPortal()` + `renderOrdersHtml()` — HTML email-safe per portale |
| `src/features/orders-report/report.ts` | `sendDailyOrdersReport()` + `armDailyOrdersReport()` — filtro test + invio |
| `src/features/orders-report/route.ts` | `POST /api/v1/orders-report/send` — trigger manuale ADMIN-ONLY |
| `src/core/email/mailer.ts` | **condiviso** con feature 005: `sendKyronEmail`, `fetchLogoBase64`, `recipientsFromEnv` |
| `src/core/scheduler.ts` | **condiviso** con feature 005: `armDailyJob`, `romeNow`, `romeYesterday` |

## Env

| Var | Scopo |
|---|---|
| `SALEOR_API_URL` | URL GraphQL Saleor (PROD: `https://api.kyronedu.it/graphql/`) |
| `SALEOR_APP_TOKEN` | App token `MANAGE_ORDERS`, accesso globale ai channel (stesso dell'export Danea) |
| `ORDERS_REPORT_ENABLED` | `true` arma il job |
| `ORDERS_REPORT_TO` | CSV destinatari |
| `ORDERS_REPORT_EXCLUDE_EMAILS` | CSV email escluse (smoke test) |

## Decisioni / gotcha

- **App token, non admin staff**: per leggere TUTTI i channel serve un'App con
  `MANAGE_ORDERS`; un admin staff con `restrictedAccessToChannels` ritorna 0 ordini
  (gotcha noto export Danea ecommerce).
- **Filtro `created` su data (UTC)**: `OrderFilterInput.created` e' un `DateRangeInput`
  (solo data), approssimazione UTC accettabile per un report "di ieri".
- **DRY col report analytics**: estratti `core/email/mailer.ts` e `core/scheduler.ts`
  e refactor di feature 005 per riusarli. Lo scheduler generico (`armDailyJob`) ora fa
  catch-up tutto il giorno dopo l'orario target (prima il report analytics catch-uppava
  solo nella finestra 09:00-09:59): comportamento piu' robusto ai restart.
- **Origine dati**: la mail manuale del 13/06 (one-off) leggeva il DB Postgres prod via
  SSH; questo job legge via Saleor GraphQL (nessun accesso DB da un servizio).

## Deploy — shipped 2026-06-14

studio-server gira su Coolify (progetto "Kyron web", env staging), app uuid
`x5bzjhuxbl4ab4j5tnkbckq0`, dominio `https://studio-server.kyronedu.it`, branch `main`, Dockerfile.

**Niente autodeploy.** L'istanza Coolify Kyron non ha un FQDN pubblico → GitHub non
raggiunge i webhook, nessun repo autodeploya. Push/merge su `main` sposta solo il ref Git;
il deploy va **triggerato** (Redeploy UI, o API). Vedi memoria `push-main-deploya-in-prod`.

**Coolify API solo da dentro il server** (la `:8000` e' chiusa dal firewall):
`ssh kyron-prod "curl -s http://localhost:8000/api/v1/<...> -H 'Authorization: Bearer <coolify-token>'"`.

Operazioni eseguite al go-live:
- Env via `POST .../applications/<uuid>/envs` (body `{"key","value","is_preview":false}`):
  `ORDERS_REPORT_ENABLED=true`, `ORDERS_REPORT_TO=team@kyronedu.it,gmail@alekdob.com`.
- `SALEOR_APP_TOKEN`: copiato **server-side** dalle env di `storefront-prod` (stessa App Saleor di Danea) senza esporlo; update con `PATCH .../envs` (un POST su key esistente da 201 ma per correggere un valore serve PATCH).
- Redeploy: `curl ".../api/v1/deploy?uuid=<uuid>&force=false"`.

**Verifica go-live** (log del container `x5bzjhux...`): devono comparire
`orders daily report armed (09:30 Europe/Rome)` + `listening on :8790`.

**Test invio forzato** (manda la mail di ieri, bypassa l'auth admin della route HTTP):
`ssh kyron-prod 'c=$(docker ps --format "{{.Names}}" | grep -i x5bzjhux | head -1); docker exec -w /app "$c" node --input-type=module -e "import(\"./dist/features/orders-report/report.js\").then(m=>m.sendDailyOrdersReport())"'`

**Gotcha**: settare un'env col valore *placeholder* (non sostituito) la crea comunque ma rompe il
runtime — verificare sempre il valore reale, e usare `PATCH` per correggerlo.
