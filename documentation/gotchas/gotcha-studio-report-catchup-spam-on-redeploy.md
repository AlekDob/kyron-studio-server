---
type: gotcha
project: studio-server
created: 2026-06-14
last_verified: 2026-06-14
tags: [scheduler, email, report, coolify, redeploy, catch-up]
---

# Report email giornalieri rispediti a ogni redeploy (spam ogni ~20 min)

## Sintomo

Le mail "Report Kyron" (analytics) e "Ordini Kyron" arrivano a `team@kyronedu.it`
+ `gmail@alekdob.com` molte volte al giorno, a orari non legati alle 09:00/09:30
(es. 15:18), apparentemente "ogni ~20 minuti".

## Causa

Lo scheduler in-process (`src/core/scheduler.ts`, `armDailyJob`) usa una guard
`lastRunDate` **in memoria** per inviare una sola volta al giorno. La condizione
originale era catch-up **illimitato**: `hour > target || (hour === target && minute >= target)`
→ scatta a QUALSIASI ora dopo il target.

`lastRunDate` si azzera a ogni avvio del processo. Coolify, a ogni redeploy,
crea un **nuovo container** (e rimuove il vecchio: `docker ps -a` mostra un solo
container, `RestartCount=0`, quindi sembra non riavviarsi). A ogni boot dopo le
09:30 il catch-up rispedisce subito ENTRAMBI i report del giorno. Se qualcosa
ridistribuisce l'app di continuo (es. health-check Coolify), risultato = spam.

Diagnosi: nessun cron server / systemd timer / GitHub workflow / scheduled agent
era coinvolto — il trigger erano i boot ripetuti del container.

## Fix

`armDailyJob` ora invia solo dentro una **finestra** `[target, target+35min)`
(`CATCHUP_WINDOW_MIN`). Un boot pomeridiano cade fuori finestra → niente invio.
Il catch-up legittimo (container su poco dopo il target) resta coperto.

Limite residuo: piu' boot DENTRO la finestra mattutina (09:00-09:35) potrebbero
ancora doppiare (guard in-memory non condivisa tra container). Improbabile; per
robustezza totale servirebbe persistenza su volume o un flag esterno.

## Da indagare a parte

Perche' il container studio-server viene ridistribuito cosi' spesso? Guardare la
deployment history su Coolify (app uuid `x5bzjhuxbl4ab4j5tnkbckq0`): probabile
health-check fallito o auto-deploy. La fix rende lo spam innocuo, ma il redeploy
loop e' uno spreco da chiudere comunque.
