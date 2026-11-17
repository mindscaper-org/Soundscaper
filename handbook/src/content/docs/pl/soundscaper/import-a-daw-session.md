---
title: "Zaimportuj sesję audio z innego edytora"
description: "Importuj obsługiwane edycje audio, ponownie połącz ich media i sprawdź ograniczenia konwersji."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"pl"} -->

Importuj obsługiwane edycje audio, ponownie połącz ich media i sprawdź ograniczenia konwersji.

## Zanim zaczniesz

Skopiuj sesję i jej audio do dostępnego folderu. Obsługiwane natywne importy sesji audio obejmują REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, sesje SoundCraft oraz Audition `.sesx` i starsze `.ses`. Zachowaj oryginalny projekt.

## Kroki

1. Wybierz **Plik > Otwarty** lub **Plik > Import**, albo przeciągnij sesję do obszaru roboczego.
2. W przeglądarce wybierz wraz z sesją powiązane audio. W wersji komputerowej po wyświetleniu monitu przyznaj dostęp do folderu z mediami.
3. Otwórz **Plik > Raport dostawy**. Sprawdź pominięte elementy i konwersje, a w razie potrzeby ponownie połącz niedostępne media.
4. Odsłuchaj reprezentatywne edycje i przejścia, sprawdź kolejność ścieżek oraz timing, po czym zapisz nowy projekt Scape.

## Sprawdź wynik

Zaimportowane cięcia powinny pasować do dostępnego źródłowego audio. Porównaj wynik z miksem referencyjnym z oryginalnego edytora, szczególnie gdy ważne są przetwarzanie, routing lub automatyzacja.

## Ograniczenia i odzyskiwanie

Import natywny konwertuje edycje audio i nie gwarantuje identycznego miksu. Zakres obsługiwanych szczegółów zależy od formatu; wtyczki z sesji źródłowej nie są uruchamiane. REAPER używa aktywnych ujęć audio i pomija tworzenie alternatywnych ujęć, MIDI, routing oraz wtyczki. Do wymiany z inną DAW używaj obsługiwanych formatów wymiany, takich jak AES31 ADL lub DAWproject, zamiast oczekiwać zapisu natywnej sesji.
