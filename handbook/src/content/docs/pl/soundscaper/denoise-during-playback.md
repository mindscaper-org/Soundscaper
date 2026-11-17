---
title: "Ogranicz szumy podczas odtwarzania"
description: "Dodaj do ścieżki dialogowej efekt AI redukujący szumy w czasie rzeczywistym."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"pl"} -->

Dodaj do ścieżki dialogowej efekt AI redukujący szumy w czasie rzeczywistym.

## Zanim zaczniesz

Użyj komputerowej wersji Soundscaper. Otwórz **Narzędzia > Zarządzanie modelami** i zainstaluj oferowany przez tę kompilację odpowiedni model redukcji szumów w czasie rzeczywistym oraz środowisko uruchomieniowe. Instalacja modelu wymaga jawnego pobrania; sama przeglądarka nie może uruchomić tego natywnego efektu.

## Kroki

1. Zaznacz zaszumioną ścieżkę dialogową i otwórz jej rack efektów czasu rzeczywistego.
2. Wybierz **Dodaj efekt**, a następnie **AI denoising (DPDFNet2)**.
3. Rozpocznij odtwarzanie i porównaj dźwięk z pominiętym efektem, korzystając z przycisku zasilania.
4. Dostosuj miks wokół oczyszczonej ścieżki i odsłuchaj eksport przed dostarczeniem. Zapisz projekt, aby zachować rack.

## Sprawdź wynik

Szumy powinny się zmniejszyć, a mowa pozostać zrozumiała. Sprawdź ciche spółgłoski, oddechy i początek odtwarzania. Jeśli słyszysz pompowanie lub zanik mowy, wyłącz efekt i porównaj z oryginałem.

## Ograniczenia i odzyskiwanie

Jest to redukcja szumów mowy, a nie ogólny efekt do odtwarzania muzyki. Na innym komputerze potrzebne będą zgodny model i natywne środowisko uruchomieniowe. Jeśli efekt jest niedostępny, sprawdź instalację i obsługę w wersji komputerowej; gdy potrzebujesz sprawdzonego wyrenderowanego rezultatu, użyj [odzyskiwania mowy w trybie offline](/soundscaper/restore-damaged-speech/). Pobrany model nie gwarantuje poprawy każdego nagrania.
