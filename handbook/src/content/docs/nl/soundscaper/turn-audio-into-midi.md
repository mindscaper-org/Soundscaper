---
title: "Opgenomen noten omzetten naar bewerkbare MIDI"
description: "Analyseer een muziekopname met Basic Pitch en bewaar bewerkbare noten naast de audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"nl"} -->

Analyseer een muziekopname met Basic Pitch en bewaar bewerkbare noten naast de audio.

## Voordat je begint

Gebruik Soundscaper voor desktop met het gepubliceerde Basic Pitch-model en de bijbehorende runtime geïnstalleerd. Begin met een korte selectie met duidelijk herkenbare toonhoogten. Bewaar de audio als luisterreferentie.

## Stappen

1. Selecteer de muziek en open **Hulpmiddelen > Geavanceerde lokale verwerking**.
2. Stel **Bewerking** in op **Audio to MIDI (Basic Pitch)**. Bevestig eventueel de vereiste toestemming voor lokale verwerking en kies **Analyseren**.
3. Kies **Resultaat controleren**, bekijk de gevonden noten en kies **Voorstel accepteren** wanneer je klaar bent.
4. Open **Venster > Piano roll (beta)**, selecteer het nieuwe MIDI-materiaal en corrigeer toonhoogten, timing en nootlengten.

## Het resultaat controleren

Naast de oorspronkelijke audio verschijnt een nieuwe MIDI-track. Kies een instrument en beluister het samen met de opname. Met **Ongedaan maken** verwijder je het geaccepteerde voorstel zonder de bronaudio te verwijderen.

## Beperkingen en herstel

De gevonden noten zijn schattingen, vooral bij complexe mixes of rumoerige opnamen. MIDI legt noten vast, niet het oorspronkelijke timbre. Gebruik [MIDI-instrumenten](/soundscaper/play-midi-instruments/) voor afspelen en **Bestand > Overige exports > Export MIDI (beta)** om de noten te delen. Ontvangers hebben nog steeds een instrument nodig dat het bedoelde geluid kan weergeven.
