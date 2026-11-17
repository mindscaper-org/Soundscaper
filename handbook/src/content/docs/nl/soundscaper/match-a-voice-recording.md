---
title: "De klank van een stemopname evenaren"
description: "Leer een klankreferentie in en gebruik Match EQ om een andere opname daar dichter bij te brengen."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"nl"} -->

Leer een klankreferentie in en gebruik Match EQ om een andere opname daar dichter bij te brengen.

## Voordat je begint

Kies een hoorbare referentie met volledig frequentiebereik van minstens een kwart seconde, bij voorkeur van dezelfde spreker in een goede opname. Houd de doelopname klaar. Dit gebruikt lokale verwerking in zowel de browser als op de desktop.

## Stappen

1. Selecteer de referentie en open **Effect > EQ en filters > Match EQ**. Kies **Learn reference from selection**.
2. Sla de ingeleerde referentie op als preset als je dit stemprofiel opnieuw wilt gebruiken. Sluit het venster.
3. Selecteer de doelopname, open Match EQ opnieuw, roep zo nodig de referentie op en kies **Analyze target**.
4. Vergelijk met **Voorbeeld** de opties **Origineel** en **Matched (level compensated)**. Pas de correctie aan en kies vervolgens **Toepassen op selectie** of **Edit as Filter Curve EQ** om de curve te bewerken.

## Het resultaat controleren

Luister bij ongeveer gelijke luidheid om de klankbalans beter te vergelijken. De verwerkte audio behoudt zijn duur en aantal kanalen. Met **Ongedaan maken** maak je de toepassing ongedaan.

## Beperkingen en herstel

Match EQ kan geen ontbrekende bandbreedte herstellen en evenaart ook geen uitvoering, dynamiek, ruimtelijke galm of stemidentiteit. Bij het vastleggen van de referentie worden trackeffecten meegenomen vóór bussen en master; het doel wordt geanalyseerd vóór het effectenrek van de track. Render de referentie eerst als het gewenste geluid afhangt van verwerking verderop.
