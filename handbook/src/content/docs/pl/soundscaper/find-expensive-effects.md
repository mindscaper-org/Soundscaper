---
title: "Znajdź efekty obciążające procesor podczas odtwarzania"
description: "Porównaj koszty efektów czasu rzeczywistego przed decyzją, które przetwarzanie uprościć."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"pl"} -->

Porównaj koszty efektów czasu rzeczywistego przed decyzją, które przetwarzanie uprościć.

## Zanim zaczniesz

Użyj projektu z efektami czasu rzeczywistego i reprezentatywnym, intensywnym fragmentem. Pomiary dotyczą tego urządzenia i obciążenia; nie tworzą uniwersalnego rankingu wtyczek.

## Kroki

1. Otwórz **Pomoc > CPU profiling**.
2. Po otwarciu panelu rozpocznij lub ponownie uruchom odtwarzanie, aby zmierzyć każdy efekt czasu rzeczywistego.
3. Obserwuj kilka aktualizacji. Porównaj wiersze efektów z wierszem podstawowego edytora; omiń jeden kosztowny efekt i powtórz ten sam fragment.
4. Po zakończeniu zamknij panel i przywróć przetwarzanie, które chcesz zachować.

## Sprawdź wynik

Użycie CPU może przekroczyć możliwości jednego rdzenia: 100% oznacza jeden w pełni zajęty rdzeń procesora. Porównaj procenty CPU oraz czasu przetwarzania. Kreska oznacza brak pomiaru, a nie zerowy koszt.

## Ograniczenia i odzyskiwanie

Czas przetwarzania obejmuje opóźnienia harmonogramu. Obciążenie GPU i zewnętrzne procesy pomocnicze są wykluczone, a samo profilowanie dodaje narzut. Pominięty efekt jest oznaczony osobno. Otwórz **Więcej opcji > Auto-idle** w nagłówku efektu, aby odpowiedni procesor mógł zasypiać podczas ciszy. Wyłącz tę opcję dla efektów wymagających ciągłego timingu. Powiązane ustawienia znajdziesz w sekcji [przetwarzanie lokalne](/help/local-processing/). Porównując zmiany, zawsze odtwarzaj tę samą frazę.
