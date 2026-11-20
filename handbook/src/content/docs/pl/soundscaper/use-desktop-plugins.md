---
title: "Używaj komputerowych wtyczek audio"
description: "Znajdź, włącz i odsłuchaj natywne efekty oraz instrumenty w komputerowej wersji Soundscaper."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"pl"} -->

Znajdź, włącz i odsłuchaj natywne efekty oraz instrumenty w komputerowej wersji Soundscaper.

## Zanim zaczniesz

Zainstaluj kompilację wtyczki zgodną z systemem operacyjnym i obsługiwanym formatem hosta. Dołączone wtyczki komputerowe są domyślnie dostępne w obsługiwanych pakietach; dodatkowe wymagają wykrycia i ewentualnego przyznania uprawnień.

## Kroki

1. Otwórz **Efekt > Zarządzanie wtyczkami**. Wyszukaj na liście i użyj **Skanowanie i ustawienia**, aby skonfigurować wykrywanie.
2. Wybierz wtyczkę i sprawdź jej wersję, uprawnienia oraz opcje odzyskiwania. Włącz ją, jeśli jest to właściwe.
3. Dodaj efekt przez **Efekt > Efekty wtyczek audio** lub rack czasu rzeczywistego. Wybierz natywne instrumenty w ustawieniach instrumentu ścieżki MIDI.
4. Odsłuchaj odtwarzanie, w razie potrzeby zapisz preset i zapisz projekt.

## Granie przez wzmacniacz gitarowy

Dodaj **OrbitAmp** z menu **Efekt > Efekty wtyczek audio** lub z panelu efektów czasu rzeczywistego ścieżki. Otwórz edytor wtyczki i wybierz wzmacniacz w sekcji **AMP**, a kolumnę głośnikową w sekcji **CAB**. Pakiet na komputer zawiera fabryczne brzmienia.

## Sprawdź wynik

Wtyczka powinna przetwarzać dźwięk i wczytać zapisane ustawienia, gdy dostępny jest ten sam zgodny plik binarny. Pomiń wtyczkę, aby porównać brzmienie, i sprawdź eksport przed dostarczeniem.

## Ograniczenia i odzyskiwanie

Pakiety Windows obsługują utrzymywane ścieżki mostkowania VST2, w tym obsługiwane wtyczki 32-bitowe. Linux może korzystać z Windows VST3 przez zainstalowaną i skonfigurowaną konfigurację yabridge/Wine; nie instaluje ona ani nie licencjonuje za Ciebie wtyczek firm trzecich. Presety nie zawierają plików wtyczek. Jeśli wtyczka zawiedzie, użyj opcji odzyskiwania w Plugin Manager i wypróbuj zgodną wersję przed wznowieniem pracy.
