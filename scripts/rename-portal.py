#!/usr/bin/env python3
"""Rinomina un portale (slug + nome), opzionalmente anonimizzandolo.

Nato per respighi -> famiglie (richiesta Andrea 2026-08-05): non c'e' convenzione reale
con il Liceo Respighi ma i genitori comprano comunque, quindi il portale perde ogni
riferimento alla scuola (slug, nome, branding, indirizzo di consegna) e passa dalla
consegna a scuola alla spedizione con corriere. Il codice meccanografico resta sul doc
Payload: serve a noi (export Danea / attribuzione agente), non e' mai mostrato al cliente.
Con ANONYMIZE=0 fa solo il rename, senza toccare identita' e spedizione.

Lo slug e' la chiave che si propaga a 3 sistemi (vedi diary 2026-07-09):
  1. doc Payload pending-schools
  2. slug del canale Saleor (portals-runtime usa `channel: doc.slug`)
  3. codici voucher dei kit (ricalcolati da slug a runtime, tenant troncato a 12 char)
Ordine: prima Saleor, poi Payload -> la finestra in cui lo storefront punterebbe a un
canale inesistente resta di pochi secondi (e il portale ha 0 ordini).
Sui voucher AGGIUNGIAMO il nuovo codice (addCodes) senza cancellare il vecchio.

I metodi di spedizione del canale NON si toccano qui (sono legati al channelId, non
allo slug): per passare a corriere serve `ecommerce/seed/set-portal-courier-shipping.ts`
con CHANNEL_SLUGS=<nuovo-slug>.

Uso:
  OLD_SLUG=famiglie NEW_SLUG=kyron-famiglie NEW_NOME="Kyron famiglie" [ANONYMIZE=1] \
  PAYLOAD_API_KEY=... SALEOR_ADMIN_EMAIL=... SALEOR_ADMIN_PASSWORD=... \
    python3 scripts/rename-portal.py [--apply]
"""
import json
import os
import re
import sys
import urllib.request

OLD_SLUG = os.environ["OLD_SLUG"]
NEW_SLUG = os.environ["NEW_SLUG"]
NEW_NOME = os.environ["NEW_NOME"]
# Identita' anonima + passaggio a domicilio: serve solo la prima volta.
ANONYMIZE = os.environ.get("ANONYMIZE") == "1"
PAYLOAD_API = "https://kyronedu.it/api"
SALEOR_API = "https://api.kyronedu.it/graphql/"

APPLY = "--apply" in sys.argv
PREFIX = "" if APPLY else "[DRY] "


def log(msg):
    print(f"{PREFIX}{msg}")


def http(url, data=None, headers=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Content-Type", "application/json")
    # Resend/Cloudflare-style UA blocks: mandiamo sempre uno UA "normale".
    req.add_header("User-Agent", "kyron-ops/1.0")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req) as res:
        return json.loads(res.read().decode())


def payload_headers():
    key = os.environ["PAYLOAD_API_KEY"]
    return {"Authorization": f"users API-Key {key}"}


_token = {}


def saleor(query, variables=None):
    if not _token:
        res = http(SALEOR_API, {
            "query": "mutation($e:String!,$p:String!){tokenCreate(email:$e,password:$p)"
                     "{token errors{message}}}",
            "variables": {"e": os.environ["SALEOR_ADMIN_EMAIL"],
                          "p": os.environ["SALEOR_ADMIN_PASSWORD"]},
        })
        tok = res["data"]["tokenCreate"]["token"]
        if not tok:
            raise SystemExit(f"login Saleor fallito: {res}")
        _token["t"] = tok
    res = http(SALEOR_API, {"query": query, "variables": variables or {}},
               {"Authorization": f"Bearer {_token['t']}"})
    if res.get("errors"):
        raise SystemExit(f"Saleor: {res['errors']}")
    return res["data"]


def voucher_code_for(tenant_slug, bundle_slug):
    """Stessa convenzione di seed/onboard-school.ts e storefront portals-runtime.ts."""
    t = re.sub(r"[^a-z0-9]", "", tenant_slug, flags=re.I).upper()[:12]
    b = re.sub(r"[^a-z0-9]", "", bundle_slug, flags=re.I).upper()
    return f"KIT-{t}-{b}-AUTO"


def main():
    # --- lettura stato (prima di mutare: i bundle servono anche dopo il rename)
    # Idempotente: dopo un run parziale il doc/canale sono gia' sul nuovo slug.
    def find_doc(slug):
        return http(f"{PAYLOAD_API}/pending-schools?where%5Bslug%5D%5Bequals%5D={slug}&limit=1",
                    headers=payload_headers())["docs"]

    docs = find_doc(OLD_SLUG) or find_doc(NEW_SLUG)
    if not docs:
        raise SystemExit(f"portale {OLD_SLUG}/{NEW_SLUG} non trovato su Payload")
    doc = docs[0]
    bundles = doc.get("bundles") or []
    log(f"Payload doc id={doc['id']} slug={doc['slug']} channelId={doc.get('channelId')}")
    log(f"bundle: {', '.join(b['slug'] for b in bundles) or '(nessuno)'}")

    channels = saleor("query{channels{id slug}}")["channels"]
    channel = next((c for c in channels if c["slug"] in (OLD_SLUG, NEW_SLUG)), None)
    if not channel:
        raise SystemExit(f"canale Saleor {OLD_SLUG}/{NEW_SLUG} non trovato")
    channel_done = channel["slug"] == NEW_SLUG

    # --- 1) Saleor: stesso channelId, slug + nome nuovi (prodotti/prezzi/promo intatti)
    log(f"1) Saleor channel {channel['id']}: slug {OLD_SLUG} -> {NEW_SLUG}, name -> {NEW_NOME}"
        + (" (gia' fatto)" if channel_done else ""))
    if APPLY and not channel_done:
        res = saleor(
            "mutation($id:ID!,$slug:String!,$name:String!){"
            "channelUpdate(id:$id,input:{slug:$slug,name:$name}){errors{field message}}}",
            {"id": channel["id"], "slug": NEW_SLUG, "name": NEW_NOME})
        errs = res["channelUpdate"]["errors"]
        if errs:
            raise SystemExit(f"channelUpdate: {errs}")

    # --- 2) Payload: identita' anonima + consegna a domicilio
    patch = {
        "slug": NEW_SLUG,
        "nome": NEW_NOME,
        "branding": {"nome": NEW_NOME, "logo": None},
    }
    if ANONYMIZE:
        patch |= {
            "shipToSchool": False,
            "shippingMethodLabel": "Spedizione con corriere",
            "sitoUfficiale": "https://kyronedu.it",
            # Indirizzo di consegna a scuola: NON si puo' svuotare (i 4 campi sono
            # required su Payload) e finisce nel <script> inline di
            # RuntimeTenantsScript, quindi nel sorgente HTML -> placeholder neutri,
            # altrimenti il nome della scuola resta leggibile su un portale anonimo.
            # Dato morto comunque: toTenant lo espone solo con shipToSchool=true.
            "schoolAddress": {"firstName": "", "lastName": "", "companyName": "Kyron",
                              "streetAddress1": "n/d", "postalCode": "00000", "city": "n/d",
                              "countryArea": "BA", "country": "IT", "phone": ""},
        }
    log(f"2) Payload: {json.dumps(patch, ensure_ascii=False)}")
    log("   codiceMeccanografico invariato: " + str(doc.get("codiceMeccanografico")))
    if APPLY:
        http(f"{PAYLOAD_API}/pending-schools/{doc['id']}", patch,
             payload_headers(), method="PATCH")

    # --- 3) Voucher kit: additivo, il vecchio codice resta inerte
    for b in bundles:
        old_code = voucher_code_for(OLD_SLUG, b["slug"])
        new_code = voucher_code_for(NEW_SLUG, b["slug"])
        found = None
        data = saleor(
            "query($c:String!){vouchers(first:100,filter:{search:$c})"
            "{edges{node{id codes(first:50){edges{node{code}}}}}}}", {"c": old_code})
        for e in data["vouchers"]["edges"]:
            codes = [c["node"]["code"] for c in e["node"]["codes"]["edges"]]
            if old_code in codes:
                found = (e["node"]["id"], codes)
                break
        if not found:
            log(f"3) [SKIP] voucher {old_code} non trovato (bundle {b['slug']})")
            continue
        vid, codes = found
        already = new_code in codes
        log(f"3) voucher {b['slug']}: +{new_code}{' (gia presente)' if already else ''}")
        if APPLY and not already:
            res = saleor("mutation($id:ID!,$c:[String!]!){"
                         "voucherUpdate(id:$id,input:{addCodes:$c}){errors{field message}}}",
                         {"id": vid, "c": [new_code]})
            errs = res["voucherUpdate"]["errors"]
            if errs:
                raise SystemExit(f"voucherUpdate: {errs}")

    log("FATTO." if APPLY else "DRY-RUN completo (aggiungi --apply per scrivere).")


if __name__ == "__main__":
    main()
