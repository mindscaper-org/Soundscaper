---
title: "Beschädigte Sprache mit einem lokalen Modell restaurieren"
description: "Prüfen Sie ein optionales Sprachrestaurierungsergebnis, bevor Sie es auf Ihre Aufnahme anwenden."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","targetLocale":"de"} -->

Prüfen Sie ein optionales Sprachrestaurierungsergebnis, bevor Sie es auf Ihre Aufnahme anwenden.

## Vor dem Start

Verwenden Sie die Desktop-App und wählen Sie die zu reparierende Sprache aus. Bewahren Sie das Original oder eine Momentaufnahme auf. Welche Modelle für die Aufgabe angeboten werden, hängt vom veröffentlichten Katalog und der installierten Laufzeit ab; VoiceFixer ist möglicherweise nicht in Ihrem Build enthalten.

## Schritte

1. Öffnen Sie **Effekt > Rauschentfernung und Reparatur > Dialog verbessern**.
2. Wählen Sie ein kompatibles **Modell**. Wenn verfügbar, zielt **VoiceFixer** auf übersteuerte und beschädigte Sprache. Installieren Sie es bei Bedarf ausdrücklich über die Modellsteuerung.
3. Führen Sie den Vorgang aus, wählen Sie danach **Ergebnis prüfen** und hören Sie das vorgeschlagene Audio zusammen mit dem Original.
4. Übernehmen Sie den Vorschlag nur, wenn sich die Sprache verbessert. Prüfen Sie vor der Anwendung die ausgewählte Position und speichern Sie das Projekt.

## Ergebnis prüfen

Achten Sie auf reparierte Spitzen und deutlichere Sprache, aber auch auf veränderte Vokale, Atemzüge und Hintergrundgeräusche. Das angenommene Ergebnis ist eine Audiobearbeitung, die Sie anhören und rückgängig machen können; Ablehnen oder Schließen der Prüfung wendet es nicht an.

## Grenzen und Wiederherstellung

VoiceFixer synthetisiert Sprache neu und kann Klangfarbe und Hintergrund verändern. Es ist kein allgemeiner Musik-De-Clipper. Fehlt es in der Modellauswahl, verwenden Sie einen angebotenen Enhancer oder den gewöhnlichen [Leitfaden zur Reparatur übersteuerter Spitzen](/guides/cleaning-up/restore-clipped-peaks/). Ein nicht angebotenes Modell lässt sich nicht allein mit diesen Schritten aktivieren.
