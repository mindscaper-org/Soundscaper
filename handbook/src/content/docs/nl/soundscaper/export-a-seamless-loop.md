---
title: "Een loop met effectstaarten exporteren"
description: "Verwerk een galm- of delaystaart in het begin van een herhalend audiobestand."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"nl"} -->

Verwerk een galm- of delaystaart in het begin van een herhalend audiobestand.

## Voordat je begint

Maak een exact loopbereik met de gewenste verwerking. Gebruik een verliesvrij formaat zoals WAV om de overgang te controleren. Houd normale afspeel- en exportniveaus onder clipping.

## Stappen

1. Selecteer het tijdsbereik dat moet herhalen en open **Bestand > Audio exporteren**.
2. Kies het geselecteerde bereik en een geschikt formaat, samplefrequentie en kanaalindeling.
3. Schakel **Render as loop** in bij de exportinstellingen. Exporteer het bestand.
4. Importeer het resultaat in een testproject en luister naar meerdere herhalingen, vooral bij de overgang.

## Het resultaat controleren

Het geëxporteerde bestand behoudt de gekozen loopduur en de gerenderde staart loopt door naar het begin. Luister naar tikken, een volumepiek en een vloeiende galmovergang.

## Beperkingen en herstel

Staarten laten overlopen kan een ongeschikte muzikale knip of een discontinu droog golfvormsignaal niet verhelpen. Dit verschilt van **Effectstaarten tot 10 seconden opnemen**, waarmee een gewone export wordt verlengd. Opgetelde staarten kunnen pieken verhogen; verlaag het niveau of gebruik de optionele true-peak-limiter van Limiter en controleer het geleverde bestand. Verliesgevende formaten kunnen opvulling toevoegen of pieken veranderen, dus controleer ook het uiteindelijke doelformaat.
