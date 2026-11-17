---
title: "Eksportuj pętlę wraz z wybrzmiewaniem efektów"
description: "Zawiń wybrzmiewanie pogłosu lub delaya na początek powtarzanego pliku audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"pl"} -->

Zawiń wybrzmiewanie pogłosu lub delaya na początek powtarzanego pliku audio.

## Zanim zaczniesz

Przygotuj dokładny zakres pętli z oczekiwanym przetwarzaniem. Do sprawdzania łączenia użyj formatu bezstratnego, takiego jak WAV. Utrzymuj zwykłe poziomy odtwarzania i eksportu poniżej przesterowania.

## Kroki

1. Zaznacz zakres czasu, który ma być zapętlony, i otwórz **Plik > Eksportuj nagranie**.
2. Wybierz zaznaczony zakres oraz odpowiedni format, częstotliwość próbkowania i układ kanałów.
3. W ustawieniach eksportu włącz **Render as loop**. Wyeksportuj plik.
4. Zaimportuj wynik do projektu testowego i odsłuchaj kilka powtórzeń, zwłaszcza miejsce łączenia.

## Sprawdź wynik

Wyeksportowany plik zachowuje wybrany czas trwania pętli, a wyrenderowane wybrzmiewanie przechodzi na jej początek. Sprawdź, czy nie ma kliknięć ani skoku poziomu i czy przejście pogłosu jest płynne.

## Ograniczenia i odzyskiwanie

Zawijanie wybrzmiewania nie naprawi niewłaściwego cięcia muzycznego ani nieciągłości suchego przebiegu fali. Różni się od opcji **Dołącz efekty do 10 sekund**, która wydłuża zwykły eksport. Suma wybrzmiewań może podnieść poziomy szczytowe; obniż poziom albo użyj opcjonalnego ograniczania true peak w Limiterze i sprawdź gotowy plik. Formaty stratne mogą dodać padding lub zmienić szczyty, więc zweryfikuj także docelowy format.
