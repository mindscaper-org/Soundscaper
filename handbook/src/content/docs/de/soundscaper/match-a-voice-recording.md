---
title: "Den Klang einer Sprachaufnahme angleichen"
description: "Lernen Sie eine Klangreferenz an und verwenden Sie Match EQ, um eine andere Aufnahme daran anzunähern."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"de"} -->

Lernen Sie eine Klangreferenz an und verwenden Sie Match EQ, um eine andere Aufnahme daran anzunähern.

## Vor dem Start

Wählen Sie eine hörbare Referenz mit vollem Frequenzumfang von mindestens einer Viertelsekunde, möglichst dieselbe Person unter guten Aufnahmebedingungen. Halten Sie die Zielaufnahme bereit. Diese Funktion nutzt lokale Verarbeitung im Browser und auf dem Desktop.

## Schritte

1. Wählen Sie die Referenz und öffnen Sie **Effekt > EQ und Filter > Match EQ**. Wählen Sie **Learn reference from selection**.
2. Speichern Sie die gelernte Referenz als Voreinstellung, wenn Sie das Stimmprofil wiederverwenden möchten. Schließen Sie den Dialog.
3. Wählen Sie das Ziel, öffnen Sie Match EQ erneut, rufen Sie bei Bedarf die Referenz ab und wählen Sie **Analyze target**.
4. Vergleichen Sie mit **Original** **Matched (level compensated)** und **Vorschau**. Passen Sie die Korrektur an und wählen Sie **Auf Auswahl anwenden** oder **Edit as Filter Curve EQ**, um die Kurve zu bearbeiten.

## Ergebnis prüfen

Hören Sie bei ähnlicher Lautstärke, ob die Klangbalance näher an der Referenz liegt. Das bearbeitete Audio behält Dauer und Kanalanzahl. **Rückgängig** macht die Anwendung rückgängig.

## Grenzen und Wiederherstellung

Match EQ kann fehlende Bandbreite nicht wiederherstellen und weder Darbietung, Dynamik, Raumhall noch die Identität der Stimme angleichen. Die Referenzaufnahme enthält Spur-Effekte vor Bussen und Master; das Ziel wird vor seinem Spuren-Rack analysiert. Rendern Sie die Referenz zuerst, wenn der gewünschte Klang von nachgelagerter Verarbeitung abhängt.
