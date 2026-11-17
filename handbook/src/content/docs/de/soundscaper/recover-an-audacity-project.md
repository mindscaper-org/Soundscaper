---
title: "Audio aus einem beschädigten Audacity-Projekt wiederherstellen"
description: "Prüfen Sie ein beschädigtes Projekt und sichern Sie wiederhergestellte Arbeit als separate Kopie."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"de"} -->

Prüfen Sie ein beschädigtes Projekt und sichern Sie wiederhergestellte Arbeit als separate Kopie.

## Vor dem Start

Erstellen Sie zuerst eine Kopie des beschädigten Audacity-Projekts. Bewahren Sie verfügbare Begleitdateien zusammen auf. Die Wiederherstellung kann unterstützte `.aup3`-Dateien und ungespeicherte Audacity-Projekte verarbeiten, aber nicht mehr vorhandene Samples neu erzeugen.

## Schritte

1. Öffnen Sie **Datei > Projektverwaltung > Audacity-Projekt wiederherstellen**.
2. Wählen Sie das beschädigte Projekt aus. Lesen Sie die **Recovery assessment**, bevor Sie etwas importieren oder speichern.
3. Prüfen Sie **Missing audio ranges**, einschließlich weiterer Seiten mit betroffenen Stellen.
4. Wählen Sie, sofern verfügbar, **Save repaired Audacity copy**. Andernfalls öffnen Sie das wiederhergestellte Ergebnis, prüfen den Kompatibilitätsbericht und speichern die Arbeit unter einem neuen Namen.

## Ergebnis prüfen

Spielen Sie wiederhergestellte Passagen ab und gleichen Sie Lücken oder Stille mit dem Bericht ab. Vergewissern Sie sich, dass sich die neue Kopie öffnen lässt, bevor Sie sich darauf verlassen. Behalten Sie die beschädigte Originaldatei für einen weiteren Wiederherstellungsversuch.

## Grenzen und Wiederherstellung

Die Wiederherstellung kann gültige Audioanfänge retten und fehlende Samples durch Stille ersetzen. Eine reparierte Datenbank bedeutet nicht, dass alles Audio erhalten blieb oder alle nativen Bearbeitungsfunktionen übertragen wurden. Prüfen Sie die gemeldeten Auslassungen und überschreiben Sie bei der Diagnose niemals Ihr einziges Original. Für intakte Projekte nutzen Sie den [Audacity-Importleitfaden](/guides/projects/open-an-audacity-project/).
