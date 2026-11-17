---
title: "Tarkastele ääntä toiston aikana"
description: "Käytä Analyysi-paneelia reaaliaikaiseen spektriin, äänekkyyteen, stereotarkistuksiin ja ACX-ääniraporttiin."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"fi"} -->

Käytä Analyysi-paneelia reaaliaikaiseen spektriin, äänekkyyteen, stereotarkistuksiin ja ACX-ääniraporttiin.

## Ennen aloitusta

Avaa projekti, jossa on ääntä. Päätä, tarkasteletko toistoa vai valittua aluetta: aikavalinta voi vaihtaa spektrin valinta-analyysiin.

## Vaiheet

1. Avaa **Analysoi > Analyysi**. Laajenna tarvitsemasi osiot, kuten **Spectrum**, spektrogrammi, äänekkyys tai korrelaatio.
2. Tyhjennä aikavalinta ja aloita toisto reaaliaikaista näkymää varten. Vertaa raitojen päällekkäisyyksiä spektrissä löytääksesi kilpailevat taajuuskaistat.
3. Pysäytä toisto ja valitse kohta, jonka spektriä haluat tarkastella ilman toistoa.
4. Avaa äänikirjan tarkistusta varten **ACX compliance** ja valitse **Check audio**. Lue tulostaulukko ja vie JSON-raportti valitsemalla **Vie**.

## Tuloksen tarkistaminen

Reaaliaikaiset näkymät reagoivat toistoon. ACX-raportti kertoo äänitarkistusten hyväksynnän tai hylkäyksen sen sijaan, että näyttäisi pelkän mittarin. Korjaa hylätyt tasot tai muotoasetukset ja tarkista uudelleen.

## Rajoitukset ja palautus

Spektri näyttää energian, ei sitä kuulostaako miksaus hyvältä. Korrelaatio ja äänekkyys vaativat asiayhteyden ja kuuntelua. ACX-äänitarkistukset eivät takaa julkaisupalvelun hyväksyntää eivätkä kata kaikkia toimituksellisia vaatimuksia. ACX-osion sulkeminen tyhjentää näytetyn tarkistuksen; suorita se uudelleen tarvittaessa. Sulje tarpeettomat analysaattorin osiot, jotta näyttötyö vähenee.
