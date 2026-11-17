---
title: "Ruis tijdens afspelen verminderen"
description: "Voeg een realtime AI-ruisonderdrukkend effect toe aan een dialoogtrack."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"nl"} -->

Voeg een realtime AI-ruisonderdrukkend effect toe aan een dialoogtrack.

## Voordat je begint

Gebruik Soundscaper voor desktop. Open **Hulpmiddelen > Modelbeheer** en installeer het realtime-ruisonderdrukkingsmodel en de runtime die bij je build worden aangeboden. Het installeren van een model vereist een expliciete download; een browser alleen kan dit native effect niet uitvoeren.

## Stappen

1. Selecteer de rumoerige dialoogtrack en open het rek met realtime-effecten.
2. Kies **Effect toevoegen** en selecteer **AI denoising (DPDFNet2)**.
3. Start het afspelen en vergelijk het geluid met uitgeschakeld effect via de aan-uitknop.
4. Stel de mix rond de opgeschoonde track af en beluister de export vóór oplevering. Sla het project op om het effectenrek te bewaren.

## Het resultaat controleren

De ruis hoort af te nemen terwijl spraak verstaanbaar blijft. Controleer zachte medeklinkers, ademhalingen en het begin van het afspelen. Als je pompen of wegvallende spraak hoort, schakel het effect dan uit en vergelijk met het origineel.

## Beperkingen en herstel

Dit is ruisonderdrukking voor spraak, geen algemene muziekrestauratie. Om op een andere computer af te spelen, zijn het compatibele model en de native runtime nodig. Als het effect ontbreekt, controleer dan de installatie en desktopondersteuning. Gebruik [offline spraakherstel](/soundscaper/restore-damaged-speech/) als je een beoordeeld gerenderd resultaat nodig hebt. Een modeldownload bewijst niet dat elke opname erop vooruitgaat.
