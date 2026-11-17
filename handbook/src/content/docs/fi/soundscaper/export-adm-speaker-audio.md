---
title: "Renderöi ADM-ohjelma kaiuttimille"
description: "Vie itse luodut ADM-sängyt ja -objektit tavalliseksi kaiutinääneksi EBU EARilla."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"fi"} -->

Vie itse luodut ADM-sängyt ja -objektit tavalliseksi kaiutinääneksi EBU EARilla.

## Ennen aloitusta

Luo ADM-ohjelma metatietomuokkaimen ADM-välilehdessä, määritä sängyt ja sijoita objektit. Selvitä toimituksen kaiutinasettelu ja valitse kontti ja koodekki, jotka tukevat sen kanavamäärää.

## Vaiheet

1. Avaa **Tiedosto > Vie ääni**.
2. Valitse kohdasta **Renderöinti > EBU EAR speaker rendering** asettelu: stereo, 5.1, 5.1.2, 5.1.4, 7.1 tai 7.1.4.
3. Tarkista tulostusmuoto, kanavamäärä ja tasoasetukset ja vie tiedosto.
4. Lue toimitusraportti ja kuuntele viety tiedosto vastaavalla kaiutinasettelulla.

## Tuloksen tarkistaminen

Tuloste sisältää renderöityä kaiutin-PCM:ää ilmoitetussa kanavajärjestyksessä. Tämä vientivalinta ei muuta projektin monitorointia tai alkuperäistä ADM-työstöä. Tarkista raportista käytetty renderöijä ja asettelu.

## Rajoitukset ja palautus

EAR-kaiutinrenderöintiä ei voi yhdistää kuulokerenderöintiin. Jaetut tulosteet ja BW64/ADM-läpivienti eivät tue tätä valintaa. Renderöidyt kanavat eivät sisällä alkuperäisiä ADM-metatietoja (bed/object); käytä siihen tarkoitukseen renderöimätöntä BW64:ää. Liikkuvat tai hajautetut objektit, HOA, bassonhallinta ja sertifioitu Dolby-renderöinti eivät kuulu ominaisuuteen. Tavallinen äänekkyysmittari tukee enintään kahdeksaa toimituskanavaa.
