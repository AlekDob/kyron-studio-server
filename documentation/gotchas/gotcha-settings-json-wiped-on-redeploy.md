---
type: gotcha
project: studio-server
created: 2026-06-15
last_verified: 2026-06-15
tags: [settings, deploy, coolify, openai, provider, persistence, prod]
---
# La chiave OpenAI / routing modelli si perde ad ogni redeploy (settings.json effimero)

## Sintomo

Dopo un redeploy Coolify di studio-server, l'agente smette di rispondere
("Provider openai non configurato: API key mancante") oppure il routing modelli
torna ai default. Sembra che il deploy "sovrascriva la chiave OpenAI".

## Causa

`src/features/settings/store.ts` persiste provider connections (incluse le API
key impostate da **Studio UI -> Impostazioni -> Provider AI**) e il model routing
in `data/settings.json`, su path `process.cwd()/data` a meno che
`SETTINGS_DATA_DIR` punti a un volume persistente. In prod `data/` NON e' su un
volume Coolify -> ogni rebuild crea un container nuovo e **cancella
settings.json**. `resolveModel` allora fa fallback su `process.env.OPENAI_API_KEY`
(env-fallback): se l'env non c'e', l'agente si rompe.

Quindi: se la chiave OpenAI e' stata messa SOLO dalla UI, il redeploy la perde.

## Fix (uno dei due, robusti)

1. **Env Coolify** (consigliato, zero codice): settare `OPENAI_API_KEY` come
   variabile d'ambiente sull'app studio-server in Coolify. Sopravvive a tutti i
   deploy via env-fallback. La UI resta opzionale per override/altri provider.
2. **Volume persistente**: settare `SETTINGS_DATA_DIR` a un path montato su un
   Coolify persistent volume, cosi' settings.json (chiavi UI + routing)
   sopravvive ai redeploy. Va migrato il settings.json esistente la prima volta.

## Workaround immediato

Dopo il redeploy, ri-inserire la chiave dalla UI: persiste nel container fresco
fino al PROSSIMO redeploy (poi si riperde). Non risolutivo.
