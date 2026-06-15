---
type: gotcha
project: studio-server
created: 2026-06-15
last_verified: 2026-06-15
tags: [payload, gateway, localized, i18n, data-corruption]
---
# PATCH localizzato Payload: scrivere UNA richiesta per locale, mai l'oggetto {it,en}

## Sintomo
Modificando un record dal modulo Dati di Studio (`studio/.../dati/[slug]/[id]`),
un campo localizzato (es. `products.name`) si **corrompe**: la colonna IT finisce
per contenere il JSON dell'intero oggetto localizzato. Dopo un secondo save si
annida ancora:

```
name = {"it":"{\"it\":\"iRide\",\"en\":\"iRide\"}","en":"EmpowerPad"}
```

(la colonna EN resta col vecchio valore — non viene mai scritta).

## Causa
Catena: form `actions.ts` → `saveRecord` manda i campi localizzati come oggetto
`{ it, en }` → `gateway.updateRecord` (studio) → studio-server
`core/payload/gateway.ts:update()` faceva **una sola** `PATCH .../:slug/:id`
**senza `?locale=`**. Payload localizza **per-richiesta**: senza `locale` scrive
sulla locale di default (it), e ricevendo un *oggetto* `{it,en}` su un campo
localizzato lo serializza dentro la colonna IT. La EN non viene toccata.

## Fix (in repo, 2026-06-15)
`update()` rileva i campi il cui valore e' un oggetto le cui sole chiavi sono
locale (`isLocalizedObject`, it/en/fr) e fa **una PATCH per locale**
(`?locale=it`, `?locale=en`), mandando lo **scalare** della locale. I campi
non-localizzati viaggiano solo con la prima richiesta. Nessun campo localizzato →
una sola PATCH come prima. Le relazioni (`{id,...}`) non matchano `isLocalizedObject`.

## Regola
Qualsiasi write verso Payload REST su campi localizzati DEVE specificare
`?locale=<loc>` e mandare valori scalari, una richiesta per locale. Mai mandare
`{it,en}` su un singolo PATCH/POST. Vale anche per `create()` se un domani il
form di creazione mandera' oggetti localizzati.

## Strascico
I record gia' corrotti prima del fix vanno riparati a mano (reset di
`{table}_locales.name` per it/en allo scalare giusto). Caso noto: prodotto
empowerpad/iRide (record #67) editato da Studio il 2026-06-15.
