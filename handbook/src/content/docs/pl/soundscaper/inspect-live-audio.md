---
title: "Analizuj dźwięk podczas odtwarzania"
description: "Użyj panelu Analysis do podglądu widma na żywo, głośności, stereo i raportu audio ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"pl"} -->

Użyj panelu Analysis do podglądu widma na żywo, głośności, stereo i raportu audio ACX.

## Zanim zaczniesz

Otwórz projekt z audio. Zdecyduj, czy chcesz analizować odtwarzanie, czy zaznaczony fragment: zaznaczenie czasu może przełączyć widmo na analizę zaznaczenia.

## Kroki

1. Otwórz **Analiza > Okno analizy**. Rozwiń potrzebne sekcje, takie jak **Spectrum**, spektrogram, głośność lub korelacja.
2. Usuń zaznaczenie czasu i rozpocznij odtwarzanie, aby uzyskać podgląd na żywo. Porównaj nakładki ścieżek na widmie, aby znaleźć konkurujące pasma częstotliwości.
3. Zatrzymaj odtwarzanie i zaznacz fragment, by sprawdzić jego widmo bez odtwarzania.
4. W przypadku audiobooków rozwiń **ACX compliance** i wybierz **Check audio**. Odczytaj tabelę wyników; użyj **Eksport**, aby zapisać raport JSON.

## Sprawdź wynik

Widoki na żywo reagują na odtwarzanie. Raport ACX przedstawia wynik zaliczony lub niezaliczony dla kontroli audio, a nie tylko wskazanie miernika. Popraw poziomy lub ustawienia formatu, które nie przeszły kontroli, i sprawdź ponownie.

## Ograniczenia i odzyskiwanie

Widmo pokazuje energię, a nie to, czy miks brzmi dobrze. Korelację i głośność należy oceniać w kontekście i po odsłuchu. Kontrola audio ACX nie gwarantuje akceptacji przez serwis wydawniczy ani nie sprawdza wszystkich wymogów redakcyjnych. Zwinięcie sekcji ACX usuwa wyświetlony wynik; w razie potrzeby uruchom kontrolę ponownie. Zamknij nieużywane sekcje analizatora, by ograniczyć obciążenie wyświetlania.
