---
title: "Ogranicz przesłuch między mikrofonami dialogowymi"
description: "Utwórz edytowalne obwiednie wzmocnienia, które ściszają skorelowany przesłuch na nieaktywnych mikrofonach."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"pl"} -->

Utwórz edytowalne obwiednie wzmocnienia, które ściszają skorelowany przesłuch na nieaktywnych mikrofonach.

## Zanim zaczniesz

Użyj od dwóch do ośmiu wyrównanych w czasie ścieżek dialogowych; najlepiej jednego mikrofonu na osobę i podobnego wzmocnienia nagrań. Zaznacz dodatni zakres czasu zawierający audio na każdej wybranej ścieżce. Odblokuj te ścieżki i wyłącz ich zamrożenie.

## Kroki

1. Zaznacz ścieżki mikrofonów i fragment do przetworzenia.
2. Otwórz **Efekt > Usuwanie i naprawa szumów > Automatic microphone-bleed reduction**.
3. Zacznij od ustawień domyślnych i wybierz **Create gain envelopes**.
4. Odtwórz fragment, zwłaszcza przerwy i nakładającą się mowę. Użyj **Wzmocnienie clipu**, aby skorygować utworzone punkty, które ściszają pożądaną mowę.

## Sprawdź wynik

Punkty wzmocnienia ograniczają przesłuch, pozostawiając dostępne oryginalne źródła i pozycje klipów. Sprawdź wejścia każdego mówcy i granice zaznaczenia. **Cofnij** cofa operację, a **Ponów** ponownie ją wykonuje.

## Ograniczenia i odzyskiwanie

Funkcja nie wyrównuje nagrań ani nie oddziela głosów wewnątrz aktywnego mikrofonu. Duże różnice wzmocnienia, pogłos i cicha mowa pod głośnym przesłuchem mogą powodować błędy. Aby wypróbować inne ustawienia, cofnij pierwsze zastosowanie: ponowne uruchomienie kumuluje tłumienie. Nie można przetwarzać zaznaczeń widmowych ani zablokowanych lub zamrożonych ścieżek.
