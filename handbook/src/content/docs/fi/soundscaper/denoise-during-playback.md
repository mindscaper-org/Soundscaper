---
title: "Vähennä kohinaa toiston aikana"
description: "Lisää dialogiraitaan reaaliaikainen tekoälypohjainen kohinanvaimennustehoste."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"fi"} -->

Lisää dialogiraitaan reaaliaikainen tekoälypohjainen kohinanvaimennustehoste.

## Ennen aloitusta

Käytä Soundscaper-työpöytäsovellusta. Avaa **Työkalut > Mallien hallinta** ja asenna kokoonpanosi tarjoama sopiva reaaliaikainen kohinanvaimennusmalli ja sen runtime. Mallin asennus on erillinen lataus; pelkkä selain ei voi suorittaa tätä natiivitehostetta.

## Vaiheet

1. Valitse kohinainen dialogiraita ja avaa sen reaaliaikatehosteräkki.
2. Valitse **Lisää tehoste** ja **AI denoising (DPDFNet2)**.
3. Aloita toisto ja vertaa ohitettua tehostetta sen virtapainikkeella.
4. Säädä miksausta siivotun raidan ympärillä ja kuuntele vienti ennen toimitusta. Tallenna projekti, jotta räkin asetukset säilyvät.

## Tuloksen tarkistaminen

Kohinan tulee vähentyä puheen pysyessä ymmärrettävänä. Tarkista hiljaiset konsonantit, hengitykset ja toiston alku. Jos kuulet pumppausta tai puhetta puuttuu, ohita tehoste ja vertaa alkuperäiseen.

## Rajoitukset ja palautus

Tämä on puheen kohinanvaimennusta, ei yleinen musiikin palautustehoste. Toisto toisella tietokoneella edellyttää yhteensopivaa mallia ja natiivia runtimea. Jos tehoste ei ole käytettävissä, tarkista asennus ja työpöytätuki. Jos tarvitset tarkistetun renderöidyn tuloksen, käytä [offline-puhepalautusta](/soundscaper/restore-damaged-speech/). Mallin lataaminen ei takaa kaikkien tallenteiden parantumista.
