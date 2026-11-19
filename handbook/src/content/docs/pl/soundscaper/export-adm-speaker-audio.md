---
title: "Wyrenderuj program ADM na głośniki"
description: "Eksportuj opracowane beds i obiekty ADM jako zwykłe audio głośnikowe za pomocą EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"pl"} -->

Eksportuj opracowane beds i obiekty ADM jako zwykłe audio głośnikowe za pomocą EBU EAR.

## Zanim zaczniesz

Opracuj program ADM na karcie ADM edytora Metadata, przypisując beds i pozycjonując obiekty. Ustal docelowy układ głośników oraz wybierz kontener i kodek obsługujący wymaganą liczbę kanałów.

## Kroki

1. Otwórz **Plik > Eksportuj nagranie**.
2. W sekcji **Renderowanie > EBU EAR speaker rendering** wybierz układ: stereo, 5.1, 5.1.2, 5.1.4, 7.1 lub 7.1.4.
3. Sprawdź format wyjściowy, liczbę kanałów i poziomy, a następnie wyeksportuj plik.
4. Przeczytaj raport dostawy i odsłuchaj wyeksportowany plik na odpowiadającym mu układzie głośników.

## Sprawdź wynik

Wynik zawiera wyrenderowane audio PCM dla głośników w zadeklarowanej kolejności kanałów. Ta opcja eksportu nie zmienia odsłuchu projektu ani oryginalnego opracowania ADM. Sprawdź w raporcie, którego renderera i układu użyto.

## Ograniczenia i odzyskiwanie

Renderowania głośnikowego EAR nie można łączyć z renderowaniem na słuchawki. Opcja nie obsługuje podzielonych wyjść ani passthrough BW64/ADM. Wyrenderowane kanały nie przenoszą oryginalnych metadanych ADM bed/object; do takiej wymiany użyj nierenderowanego BW64. Ruchome lub rozproszone obiekty, HOA, zarządzanie basem i certyfikowane renderowanie Dolby nie są objęte tą funkcją. Zwykły miernik głośności obsługuje maksymalnie osiem kanałów wyjściowych.
