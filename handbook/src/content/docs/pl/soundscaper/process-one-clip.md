---
title: "Zastosuj efekty czasu rzeczywistego do jednego klipu"
description: "Przydziel jedenemu klipowi audio własny rack efektów, bez przetwarzania wszystkich klipów ścieżki."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"pl"} -->

Przydziel jednemu klipowi audio własny rack efektów, bez przetwarzania wszystkich klipów ścieżki.

## Zanim zaczniesz

Zaznacz klip audio w Soundscaper. Efekty klipu należą do jego przetwarzania i trafiają dalej do efektów ścieżki; przetwarzanie ścieżki i mastera również może zmienić to, co słyszysz.

## Kroki

1. Otwórz **Okno > Właściwości klipu** i rozwiń **Efekty**. To rack efektów klipu.
2. Kliknij **Dodaj efekt**, wybierz efekt i dostosuj ustawienia. Odtwórz klip, aby go odsłuchać.
3. Użyj przycisku zasilania efektu, aby porównać dźwięk z włączonym i pominiętym przetwarzaniem. W razie potrzeby zmień kolejność efektów lub usuń je z racka.
4. Zapisz projekt, a następnie odsłuchaj klip z sąsiednimi klipami. Jeśli zmiana nie pomaga, użyj **Cofnij**.

## Sprawdź wynik

Wybrany klip ma własne przetwarzanie, a pozostałe klipy zachowują swoje ustawienia. Odsłuchaj fragment za jego końcem, aby usłyszeć pogłos lub delay. Sprawdź rack ścieżki, jeśli łączny efekt jest zbyt mocny.

## Ograniczenia i odzyskiwanie

Wybrzmiewanie efektu może trwać dłużej niż źródłowe audio klipu; przed dostarczeniem sprawdź opcje wybrzmiewania przy eksporcie. W przypadku detektora Auto Duck wybierz inną odpowiednią ścieżkę; pętle sprzężenia zwrotnego są odrzucane. Otwórz **Więcej opcji > Auto-idle** w nagłówku efektu, aby sterować uśpieniem podczas ciszy. Wyłącz tę opcję dla wtyczek wrażliwych na timing. Zobacz [przetwarzanie lokalne](/help/local-processing/), aby poznać powiązane ustawienia.
