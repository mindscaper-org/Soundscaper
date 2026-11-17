---
title: "Eine ersetzte Dialogaufnahme ausrichten"
description: "Passen Sie eine zweite Darbietung derselben Worte an einen Referenzclip an."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","targetLocale":"de"} -->

Passen Sie eine zweite Darbietung derselben Worte an einen Referenzclip an.

## Vor dem Start

Bereiten Sie zwei entsperrte Mono- oder Stereo-Audioclips von je 0,25 bis 30 Sekunden Länge vor. Sie müssen dieselben Worte und eine hinreichend ähnliche Darbietung enthalten. Rendern oder entkoppeln Sie zunächst videoverknüpftes oder am Takt verankertes Material.

## Schritte

1. Öffnen Sie **Bearbeiten > Audio-Clips > Align dialogue**.
2. Wählen Sie Referenz und Ersatz ausdrücklich aus und legen Sie anschließend die Ausrichtungsstärke fest.
3. Wählen Sie **Analyze and align**. Vergleichen Sie **Play reference**, **Play replacement** und **Play aligned**. Achten Sie auf Konsonanten und Atemzüge.
4. Wählen Sie **Create aligned copy** nur, wenn das Ergebnis stimmt.

## Ergebnis prüfen

Eine neue Spur enthält eine ausgerichtete Kopie mit Anfang und Dauer der Referenz. Die Originale bleiben verfügbar. **Rückgängig** entfernt die erstellte Kopie in einem Schritt. Speichern und öffnen Sie das Projekt erneut, wenn Sie das gerenderte Ergebnis ohne erneute Analyse verwenden möchten.

## Grenzen und Wiederherstellung

Der Ersatz muss zwischen der halben und der doppelten Länge der Referenz liegen. Die Ausrichtung ist akustisch: Lippen werden nicht untersucht und ein Transkript nicht überprüft. Andere Worte, Hintergrundgeräusche oder überlappende Sprecher können die Ausrichtung verhindern. Wenn die Analyse keine Übereinstimmung findet, verwenden Sie kürzere, ähnliche Sätze oder bearbeiten Sie das Material manuell. Eine Änderung der Eingaben oder Stärke erfordert eine erneute Analyse.
