---
title: "Dopasuj brzmienie nagrania głosu"
description: "Naucz się referencji tonalnej i użyj Match EQ, aby zbliżyć do niej inne nagranie."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"pl"} -->

Naucz się referencji tonalnej i użyj Match EQ, aby zbliżyć do niej inne nagranie.

## Zanim zaczniesz

Wybierz słyszalną referencję o pełnym paśmie częstotliwości, trwającą co najmniej ćwierć sekundy; najlepiej, jeśli to dobre nagranie tego samego mówcy. Przygotuj nagranie docelowe. Funkcja korzysta z przetwarzania lokalnego zarówno w przeglądarce, jak i w wersji komputerowej.

## Kroki

1. Zaznacz referencję i otwórz **Efekt > Równoległe i filtry > Match EQ**. Wybierz **Learn reference from selection**.
2. Jeśli chcesz ponownie użyć profilu tego głosu, zapisz nauczoną referencję jako preset. Zamknij okno dialogowe.
3. Zaznacz nagranie docelowe, ponownie otwórz Match EQ, w razie potrzeby wczytaj referencję i kliknij **Analyze target**.
4. Za pomocą **Podgląd** porównaj **Oryginalny** i **Matched (level compensated)**. Dostosuj korekcję, a następnie wybierz **Zastosuj do wyboru** albo **Edit as Filter Curve EQ**, aby edytować krzywą.

## Sprawdź wynik

Odsłuchaj materiał przy podobnej głośności, aby porównać równowagę tonalną. Przetworzone audio zachowuje czas trwania i liczbę kanałów. **Cofnij** cofa zastosowanie efektu.

## Ograniczenia i odzyskiwanie

Match EQ nie odtworzy brakującego pasma ani nie dopasuje wykonania, dynamiki, pogłosu pomieszczenia czy tożsamości głosu. Rejestrowanie referencji obejmuje efekty ścieżki przed szynami i masterem; materiał docelowy jest analizowany przed rackiem efektów ścieżki. Najpierw wyrenderuj referencję, jeśli jej pożądane brzmienie zależy od dalszego przetwarzania.
