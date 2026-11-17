---
title: "Übersprechen zwischen Dialogmikrofonen verringern"
description: "Erstellen Sie bearbeitbare Gain-Hüllkurven, die korreliertes Übersprechen auf inaktiven Mikrofonen absenken."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"de"} -->

Erstellen Sie bearbeitbare Gain-Hüllkurven, die korreliertes Übersprechen auf inaktiven Mikrofonen absenken.

## Vor dem Start

Verwenden Sie zwei bis acht zeitlich ausgerichtete Dialogspuren, idealerweise ein Mikrofon pro Person und vergleichbare Aufnahmepegel. Wählen Sie einen positiven Zeitbereich aus, der Audio auf allen ausgewählten Spuren enthält. Entsperren und entfrieren Sie diese Spuren.

## Schritte

1. Wählen Sie die Mikrofonspuren und den zu bearbeitenden Abschnitt aus.
2. Öffnen Sie **Effekt > Rauschentfernung und Reparatur > Automatic microphone-bleed reduction**.
3. Behalten Sie zunächst die Standardeinstellungen bei und wählen Sie **Create gain envelopes**.
4. Spielen Sie den Abschnitt ab, insbesondere Unterbrechungen und überlappende Sprache. Passen Sie mit **Clip-Verstärkung** generierte Punkte an, die gewünschte Sprache absenken.

## Ergebnis prüfen

Gain-Punkte verringern das Übersprechen; die Originalquellen und Clip-Positionen bleiben erhalten. Prüfen Sie die Einsätze jeder sprechenden Person und die Auswahlgrenzen. **Rückgängig** entfernt den Vorgang, **Wiederherstellen** stellt ihn wieder her.

## Grenzen und Wiederherstellung

Die Funktion richtet Aufnahmen nicht aus und trennt keine Stimmen innerhalb eines aktiven Mikrofons. Große Pegelunterschiede, Hall und leise Sprache unter lautem Übersprechen können zu Fehlern führen. Wenn Sie andere Einstellungen ausprobieren, machen Sie zuerst die erste Anwendung rückgängig, sonst summieren sich die Absenkungen. Spektrale Auswahlen sowie gesperrte und eingefrorene Spuren können nicht verarbeitet werden.
