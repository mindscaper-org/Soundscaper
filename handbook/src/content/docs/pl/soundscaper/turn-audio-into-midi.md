---
title: "Zamień nagrane nuty na edytowalne MIDI"
description: "Przeanalizuj nagranie muzyczne za pomocą Basic Pitch i zachowaj edytowalne nuty obok audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"pl"} -->

Przeanalizuj nagranie muzyczne za pomocą Basic Pitch i zachowaj edytowalne nuty obok audio.

## Zanim zaczniesz

Użyj Soundscaper w wersji komputerowej z zainstalowanym opublikowanym modelem Basic Pitch i zgodnym środowiskiem uruchomieniowym. Zacznij od krótkiego fragmentu o wyraźnych wysokościach dźwięków. Zachowaj audio jako odniesienie do odsłuchu.

## Kroki

1. Zaznacz fragment muzyczny i otwórz **Narzędzia > Zaawansowana obróbka lokalna**.
2. Ustaw **Operacja** na **Audio to MIDI (Basic Pitch)**. Potwierdź wymaganą zgodę na przetwarzanie lokalne i wybierz **Analiza**.
3. Wybierz **Przejrzyj wynik**, sprawdź wykryte nuty i kliknij **Zaakceptuj propozycję**, gdy będą gotowe.
4. Otwórz **Okno > Piano roll (beta)**, zaznacz nowy materiał MIDI i popraw wysokości, czas oraz długości nut.

## Sprawdź wynik

Obok oryginalnego audio pojawi się nowa ścieżka MIDI. Wybierz instrument i odsłuchaj go razem z nagraniem. **Cofnij** usuwa zaakceptowaną propozycję bez usuwania źródłowego audio.

## Ograniczenia i odzyskiwanie

Wykryte nuty są przybliżeniem, szczególnie w gęstych miksach i zaszumionych nagraniach. MIDI zapisuje nuty, a nie oryginalną barwę. Użyj [instrumentów MIDI](/soundscaper/play-midi-instruments/) do odtwarzania, a **Plik > Eksportuj inne > Export MIDI (beta)**, aby udostępnić nuty. Odbiorcy nadal potrzebują instrumentu, który może odtworzyć zamierzony dźwięk.
