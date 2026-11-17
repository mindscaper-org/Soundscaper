---
title: "MIDI über ein Instrument wiedergeben"
description: "Wählen Sie einen Synthesizer für MIDI-Noten und behalten Sie die bearbeitbare Darbietung."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"de"} -->

Wählen Sie einen Synthesizer für MIDI-Noten und behalten Sie die bearbeitbare Darbietung.

## Vor dem Start

Öffnen oder importieren Sie MIDI oder erstellen Sie eine neue Spur in Soundscaper. Die integrierten Wiedergabemöglichkeiten variieren je nach optional verfügbaren nativen Instrumenten. Native Plug-in-Instrumente benötigen die Desktop-App und ein passendes aktiviertes Plug-in.

## Schritte

1. Wählen Sie **Spuren > Neue Spur hinzufügen > MIDI-Spur (Beta)**, wenn Sie eine Spur benötigen.
2. Öffnen Sie **Fenster > Piano-Roll (Beta)**. Fügen Sie Noten hinzu oder wählen Sie vorhandenes MIDI-Material aus.
3. Wählen Sie **Instrument**. Öffnen Sie bei einem nativen Instrument **Instrument settings**, um den Klang anzupassen und eine Voreinstellung zu speichern.
4. Starten Sie die Wiedergabe, prüfen Sie Noten und Ausklang und speichern Sie das Projekt. Öffnen Sie es erneut.

## Ergebnis prüfen

Das gewählte Instrument sollte zu hören sein, während die Noten in der Klavierrolle bearbeitbar bleiben. Einstellungen und Voreinstellungen des Instruments sollten beim erneuten Öffnen wiederhergestellt werden, sofern das benötigte Plug-in installiert ist.

## Grenzen und Wiederherstellung

Native Instrumente werden für MIDI-Spuren angeboten, nicht für gewöhnliche Audiospuren. Eine gespeicherte Voreinstellung enthält weder die Plug-in-Binärdatei noch externe Bibliotheken. Mitgelieferte Instrumente sind in unterstützten Desktop-Paketen standardmäßig aktiviert; andere Instrumente benötigen möglicherweise den [Plug-in-Manager](/soundscaper/use-desktop-plugins/). Prüfen Sie Wiedergabe und Export auf dem Zielcomputer, bevor Sie sich auf denselben Klang verlassen.
