---
title: "Sovita äänitallenteen sointia"
description: "Opi sointiviite ja käytä Match EQ:tä tuodaksesi toisen äänitteen lähemmäs sitä."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"fi"} -->

Opi sointiviite ja käytä Match EQ:tä tuodaksesi toisen äänitteen lähemmäs sitä.

## Ennen aloitusta

Valitse kuuluva, koko taajuusalueen kattava vähintään neljännessekunnin viite, mieluiten sama puhuja hyvin tallennettuna. Valmistele kohdetallenne. Paikallinen käsittely toimii sekä selaimessa että työpöytäsovelluksessa.

## Vaiheet

1. Valitse viite ja avaa **Tehoste > Taajuuskorjain ja suotimet > Match EQ**. Valitse **Learn reference from selection**.
2. Tallenna opittu viite esiasetukseksi, jos haluat käyttää ääniprofiilia uudelleen. Sulje valintaikkuna.
3. Valitse kohde, avaa Match EQ uudelleen, palauta viite tarvittaessa ja valitse **Analyze target**.
4. Vertaa **Alkuperäinen** avulla vaihtoehtoja **Matched (level compensated)** ja **Esikatselu**. Säädä korjausta ja valitse **Käytä valintaan** tai muokkaa käyrää valitsemalla **Edit as Filter Curve EQ**.

## Tuloksen tarkistaminen

Kuuntele samalla äänenvoimakkuudella ja arvioi, onko sointitasapaino lähempänä. Käsitellyn äänen kesto ja kanavien määrä pysyvät ennallaan. **Kumoa** peruuttaa soveltamisen.

## Rajoitukset ja palautus

Match EQ ei voi palauttaa puuttuvaa kaistanleveyttä eikä sovittaa esitystä, dynamiikkaa, huonekaikua tai äänen identiteettiä. Viitteen tallennus sisältää raitatehosteet ennen busseja ja masteria, kun taas kohde analysoidaan ennen sen raitaräkkiä. Renderöi viite ensin, jos haluttu ääni riippuu myöhemmästä käsittelystä.
