---
title: "Een ADM-programma voor luidsprekers renderen"
description: "Exporteer gemaakte ADM-beds en -objecten als gewone luidsprekeraudio met EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"nl"} -->

Exporteer gemaakte ADM-beds en -objecten als gewone luidsprekeraudio met EBU EAR.

## Voordat je begint

Maak een ADM-programma in het tabblad ADM van de Metadata editor, met bedtoewijzingen en gepositioneerde objecten. Weet welke luidsprekerindeling je moet leveren en kies een container en codec die het aantal kanalen aankunnen.

## Stappen

1. Open **Bestand > Audio exporteren**.
2. Kies onder **Renderen > EBU EAR speaker rendering** een indeling: stereo, 5.1, 5.1.2, 5.1.4, 7.1 of 7.1.4.
3. Controleer het uitvoerformaat, het aantal kanalen en de niveaus en exporteer vervolgens.
4. Lees het leveringsrapport en beluister het geëxporteerde bestand via de bijbehorende luidsprekerindeling.

## Het resultaat controleren

De uitvoer bevat gerenderde luidspreker-PCM in de opgegeven kanaalvolgorde. Deze exportkeuze wijzigt noch de projectmonitoring noch de oorspronkelijke ADM-bewerking. Controleer in het rapport welke renderer en indeling zijn gebruikt.

## Beperkingen en herstel

EAR-luidsprekerweergave kan niet worden gecombineerd met hoofdtelefoonweergave. Gesplitste uitvoer en BW64/ADM-passthrough ondersteunen deze optie niet. Gerenderde kanalen bevatten niet de oorspronkelijke ADM-metadata van bed/object ADM; gebruik voor deze uitwisseling ongerenderde BW64. Bewegende of diffuse objecten, HOA, basbeheer en gecertificeerde Dolby-weergave vallen buiten deze functie. De gewone luidheidsmeter ondersteunt maximaal acht geleverde kanalen.
