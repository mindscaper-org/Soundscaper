---
title: "Rauschen während der Wiedergabe verringern"
description: "Fügen Sie einer Dialogspur einen KI-Rauschminderungs-Effekt in Echtzeit hinzu."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"de"} -->

Fügen Sie einer Dialogspur einen KI-Rauschminderungs-Effekt in Echtzeit hinzu.

## Vor dem Start

Verwenden Sie Soundscaper Desktop. Öffnen Sie **Werkzeuge > Modellverwaltung** und installieren Sie das passende Echtzeit-Rauschminderungsmodell und die Laufzeit, die Ihr Build anbietet. Die Modellinstallation ist ein ausdrücklicher Download; ein Browser allein kann diesen nativen Effekt nicht ausführen.

## Schritte

1. Wählen Sie die verrauschte Dialogspur aus und öffnen Sie ihr Echtzeiteffekt-Rack.
2. Wählen Sie **Effekt hinzufügen** und anschließend **AI denoising (DPDFNet2)**.
3. Starten Sie die Wiedergabe und vergleichen Sie über die Ein-/Aus-Schaltfläche den Klang mit umgangenem Effekt.
4. Passen Sie den Mix rund um die bereinigte Spur an und hören Sie den Export vor der Ausgabe ab. Speichern Sie das Projekt, damit das Rack erhalten bleibt.

## Ergebnis prüfen

Das Rauschen sollte abnehmen, während die Sprache verständlich bleibt. Prüfen Sie leise Konsonanten, Atemzüge und den Wiedergabebeginn. Wenn der Klang pumpt oder Sprache fehlt, umgehen Sie den Effekt und vergleichen Sie mit dem Original.

## Grenzen und Wiederherstellung

Dies ist Sprachentrauschen und kein allgemeiner Effekt zur Musikrestaurierung. Für die Wiedergabe auf einem anderen Computer werden das kompatible Modell und die native Laufzeit benötigt. Ist der Effekt nicht verfügbar, prüfen Sie Installation und Desktop-Unterstützung. Für ein geprüftes gerendertes Ergebnis verwenden Sie die [Offline-Sprachrestaurierung](/soundscaper/restore-damaged-speech/). Ein Modelldownload beweist nicht, dass sich jede Aufnahme damit verbessert.
