---
title: "Użyj zapisanego projektu jako połączonego audio"
description: "Wstaw zapisany projekt do innej aranżacji i uwzględniaj jego późniejsze zmiany."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"pl"} -->

Wstaw zapisany projekt do innej aranżacji i uwzględniaj jego późniejsze zmiany.

## Zanim zaczniesz

Zapisz podrzędny projekt Soundscaper w tej samej lokalnej bibliotece projektów. Najpierw ukończ jego miks. Wyrenderuj i zatwierdź przetwarzanie aktywnych natywnych wtyczek do audio, zanim użyjesz renderera podprojektów działającego w tle.

## Kroki

1. Otwórz projekt nadrzędny i wybierz **Plik > Subprojects**.
2. Wybierz podrzędny projekt w polu **Project to insert or relink**, a następnie kliknij **Insert subproject**. Opublikowany miks pojawi się na nowej ścieżce.
3. Zaznacz łącze w sekcji **Linked subprojects** i wybierz **Open subproject**, aby edytować projekt podrzędny. Zapisz go, a potem wróć do nadrzędnego, by odsłuchać zaktualizowane audio.
4. Wybierz **Pin current audio**, aby zachować tę wersję, albo **Make independent audio**, aby przestać śledzić projekt podrzędny.

## Sprawdź wynik

Po aktualizacji projektu podrzędnego położenie jego audio w projekcie nadrzędnym nie zmienia się. Po odświeżeniu odtwórz je i sprawdź początek oraz koniec. Krótszy miks podrzędny zostanie uzupełniony ciszą w pierwotnie opublikowanym zakresie.

## Ograniczenia i odzyskiwanie

Opublikowany czas trwania i układ kanałów są stałe; dla innego zakresu wstaw kolejne wystąpienie. Przenośny plik projektu nadrzędnego zawiera zainstalowane audio, ale nie edytowalny projekt podrzędny. Przenieś go osobno i użyj **Relink to selected project**. Cykliczne łącza są odrzucane.
