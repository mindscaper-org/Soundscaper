---
title: "Wyrównaj zastępcze nagranie dialogu"
description: "Dopasuj drugie wykonanie tych samych słów do klipu referencyjnego."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","targetLocale":"pl"} -->

Dopasuj drugie wykonanie tych samych słów do klipu referencyjnego.

## Zanim zaczniesz

Przygotuj dwa odblokowane klipy mono lub stereo, każdy o długości 0,25–30 sekund. Powinny zawierać te same słowa i mieć zbliżony sposób wypowiedzi. Najpierw wyrenderuj materiał połączony z wideo lub zakotwiczony w taktach albo odłącz go od tych elementów.

## Kroki

1. Otwórz **Edytuj > Klipy audio > Align dialogue**.
2. Jawnie wybierz referencję i nagranie zastępcze, a następnie ustaw siłę wyrównania.
3. Kliknij **Analyze and align**. Porównaj **Play reference**, **Play replacement** i **Play aligned**. Uważnie odsłuchaj spółgłoski i oddechy.
4. Wybierz **Create aligned copy** dopiero wtedy, gdy wynik brzmi poprawnie.

## Sprawdź wynik

Na nowej ścieżce pojawi się wyrównana kopia o początku i czasie trwania referencji. Oryginały pozostaną dostępne. **Cofnij** usuwa utworzoną kopię w jednym kroku. Zapisz projekt i otwórz go ponownie, aby korzystać z wyrenderowanego wyniku bez ponownej analizy.

## Ograniczenia i odzyskiwanie

Nagranie zastępcze musi trwać od połowy do dwukrotności czasu referencji. Wyrównanie opiera się na dźwięku; nie analizuje ruchu ust ani nie weryfikuje transkrypcji. Różne słowa, szum tła lub nakładający się głos mogą uniemożliwić dopasowanie. Jeśli analiza odrzuci dopasowanie, użyj krótszych, zgodnych fraz albo edytuj ręcznie. Zmiana wejść lub siły wymaga ponownej analizy.
