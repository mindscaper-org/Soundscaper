---
title: "Tuo äänisessio toisesta editorista"
description: "Tuo tuettuja äänen muokkauksia, yhdistä niiden mediat uudelleen ja tarkista muunnoksen rajoitukset."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"fi"} -->

Tuo tuettuja äänen muokkauksia, yhdistä niiden mediat uudelleen ja tarkista muunnoksen rajoitukset.

## Ennen aloitusta

Kopioi sessio ja sen ääni saatavilla olevaan kansioon. Natiivia äänisessiotuontia tuetaan seuraaville: REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, SoundCraft-sessiot sekä Audition `.sesx` tai vanha `.ses`. Säilytä alkuperäinen projekti.

## Vaiheet

1. Valitse **Tiedosto > Avaa** tai **Tiedosto > Tuo** tai pudota sessio työtilaan.
2. Valitse selaimessa session mukana toimitettu ääni. Anna työpöytäsovellukselle pyydettäessä käyttöoikeus mediatiedostokansioon.
3. Avaa **Tiedosto > Toimitusraportti**. Lue pois jätetyistä ja muunnetuista tiedoista ja linkitä offline-media uudelleen tarvittaessa.
4. Kuuntele edustavia leikkauksia ja häivytyksiä, tarkista raitojen järjestys ja ajoitus ja tallenna uusi Scape-projekti.

## Tuloksen tarkistaminen

Tuotujen leikkausten tulee kohdistua saatavilla olevaan lähdeääneen. Vertaa tulosta alkuperäisen editorin vertailumiksaukseen, etenkin jos käsittely, reititys tai automaatio on tärkeää.

## Rajoitukset ja palautus

Natiivi tuonti muuntaa äänen muokkauksia eikä takaa täsmälleen samanlaista miksausta. Tuetut tiedot vaihtelevat formaatin mukaan; lähdesession liitännäisiä ei suoriteta. REAPER käyttää aktiivisia äänikestoja ja jättää pois vaihtoehtoisten ottojen luonnin, MIDIn, reitityksen ja liitännäiset. Käytä toiseen DAW:hen vaihtamiseen tuettuja formaatteja kuten AES31 ADL tai DAWproject sen sijaan, että odottaisit natiivin session kirjoitusta.
