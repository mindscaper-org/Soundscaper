---
title: "Etsi toiston aikana paljon suoritinta käyttäviä tehosteita"
description: "Vertaa reaaliaikatehosteiden kuormitusta ennen kuin päätät yksinkertaistaa käsittelyä."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"fi"} -->

Vertaa reaaliaikatehosteiden kuormitusta ennen kuin päätät yksinkertaistaa käsittelyä.

## Ennen aloitusta

Käytä projektia, jossa on reaaliaikatehosteita ja edustava vaativa kohta. Mittaukset kuvaavat tätä laitetta ja työkuormaa; ne eivät muodosta yleispätevää liitännäisten paremmuusjärjestystä.

## Vaiheet

1. Avaa **Ohje > CPU profiling**.
2. Käynnistä toisto tai aloita se uudelleen paneelin avaamisen jälkeen, jotta jokainen reaaliaikatehoste voidaan mitata.
3. Seuraa useita päivityksiä. Vertaa tehosterivejä editorin perusriviin, ohita yksi raskas tehoste ja toista sama kohta uudelleen.
4. Sulje paneeli työn jälkeen ja palauta haluamasi käsittely.

## Tuloksen tarkistaminen

Suorittimen käyttö voi ylittää yhden ytimen kapasiteetin: 100 % tarkoittaa yhden CPU-ytimen täyttä käyttöä. Vertaa suorittimen käyttöä ja käsittelyyn kulunutta aikaa prosentteina. Viiva tarkoittaa, ettei mittausta ole saatavilla, ei ettei tehoste kuluttaisi resursseja.

## Rajoitukset ja palautus

Käsittelyyn kulunut aika sisältää ajoitusviiveitä. GPU:n käyttö ja ulkoiset apuprosessit eivät sisälly mittaukseen, ja profilointi itsessään lisää kuormaa. Ohitettu tehoste merkitään erikseen. Avaa tehosteen otsakkeesta **Lisää vaihtoehtoja > Auto-idle**, jotta sopiva prosessori voi siirtyä lepotilaan hiljaisuuden aikana. Poista toiminto käytöstä jatkuvaa ajoitusta vaativissa tehosteissa. Katso aiheeseen liittyviä asetuksia kohdasta [Paikallinen käsittely](/help/local-processing/). Toista aina sama kohta, kun vertaat muutoksia.
