---
title: "Desktop-audioplug-ins gebruiken"
description: "Zoek native effecten en instrumenten in Soundscaper voor desktop, schakel ze in en beluister ze."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"nl"} -->

Zoek native effecten en instrumenten in Soundscaper voor desktop, schakel ze in en beluister ze.

## Voordat je begint

Installeer een plug-inbuild die compatibel is met je besturingssysteem en een ondersteund hostformaat. In ondersteunde pakketten zijn meegeleverde desktopplug-ins standaard beschikbaar; voor extra plug-ins moet je ze nog opsporen en eventueel toestemming geven.

## Stappen

1. Open **Effect > Plugin Manager**. Zoek in de lijst en gebruik **Scannen en instellingen** voor de detectie-instellingen.
2. Selecteer de plug-in en controleer de versie, machtiging en herstelopties. Schakel de plug-in in wanneer dat passend is.
3. Voeg een effect toe via **Effect > Audio Plugins** of een realtime-rek. Selecteer native instrumenten via de instrumentbediening van een MIDI-track.
4. Beluister de weergave, sla zo nodig een preset op en sla het project op.

## Via een gitaarversterker spelen

Voeg **OrbitAmp** toe via **Effect > Audio Plugins** of het realtime-effectenrek van een spoor. Open de plug-in-editor en kies een versterker in de sectie **AMP** en een luidsprekerkast in de sectie **CAB**. De desktopbundel bevat de fabrieksgeluiden.

## Het resultaat controleren

De bedoelde plug-in hoort het geluid te verwerken en met de opgeslagen instellingen te laden wanneer hetzelfde compatibele binaire bestand beschikbaar is. Schakel de plug-in uit om te vergelijken en controleer de export vóór oplevering.

## Beperkingen en herstel

Windows-pakketten ondersteunen de onderhouden VST2-bridgepaden, waaronder ondersteunde 32-bits plug-ins. Linux kan Windows VST3 gebruiken met een geïnstalleerde en geconfigureerde yabridge/Wine-omgeving; daarmee installeer of licentieer je geen plug-ins van derden. Presets bevatten geen plug-inbestanden. Werkt een plug-in niet, gebruik dan de herstelopties in Plugin Manager en probeer een compatibele versie voordat je verder werkt.
