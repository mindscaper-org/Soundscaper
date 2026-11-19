---
title: "Aufgenommene Noten in bearbeitbares MIDI umwandeln"
description: "Analysieren Sie eine Musikaufnahme mit Basic Pitch und behalten Sie bearbeitbare Noten neben dem Audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"de"} -->

Analysieren Sie eine Musikaufnahme mit Basic Pitch und behalten Sie bearbeitbare Noten neben dem Audio.

## Vor dem Start

Verwenden Sie Soundscaper Desktop mit installiertem, veröffentlichtem Basic-Pitch-Modell und passender Laufzeit. Beginnen Sie mit einer kurzen Musikauswahl mit klaren Tonhöhen. Bewahren Sie das Audio als Hörreferenz auf.

## Schritte

1. Wählen Sie das Musik-Audio aus und öffnen Sie **Werkzeuge > Erweiterte lokale Verarbeitung**.
2. Setzen Sie **Vorgang** auf **Audio to MIDI (Basic Pitch)**. Bestätigen Sie gegebenenfalls die Einwilligung zur lokalen Verarbeitung und wählen Sie **Analyse**.
3. Wählen Sie **Ergebnis prüfen**, untersuchen Sie die erkannten Noten und wählen Sie **Vorschlag übernehmen**, wenn Sie bereit sind.
4. Öffnen Sie **Fenster > Piano-Roll (Beta)**, wählen Sie das neue MIDI-Material aus und korrigieren Sie Tonhöhe, Timing und Notenlänge.

## Ergebnis prüfen

Neben dem Originalaudio erscheint eine neue MIDI-Spur. Wählen Sie ein Instrument und hören Sie es im Vergleich zur Aufnahme ab. **Rückgängig** entfernt den angenommenen Vorschlag, ohne das Quellaudio zu löschen.

## Grenzen und Wiederherstellung

Erkannte Noten sind Schätzungen, besonders bei dichten Mischungen oder verrauschten Aufnahmen. MIDI enthält Noten, nicht das ursprüngliche Klangbild. Verwenden Sie [MIDI-Instrumente](/soundscaper/play-midi-instruments/) zur Wiedergabe und **Datei > Weitere Exporte > MIDI exportieren (Beta)**, um Noten zu teilen. Empfänger benötigen weiterhin ein Instrument, das den gewünschten Klang erzeugen kann.
