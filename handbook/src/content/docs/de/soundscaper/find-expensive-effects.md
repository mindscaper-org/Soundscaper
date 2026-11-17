---
title: "Effekte mit hoher CPU-Last bei der Wiedergabe finden"
description: "Vergleichen Sie die Kosten von Echtzeiteffekten, bevor Sie deren Verarbeitung vereinfachen."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"de"} -->

Vergleichen Sie die Kosten von Echtzeiteffekten, bevor Sie deren Verarbeitung vereinfachen.

## Vor dem Start

Verwenden Sie ein Projekt mit Echtzeiteffekten und einem repräsentativen, ausgelasteten Abschnitt. Die Messwerte gelten für dieses Gerät und diese Arbeitslast; sie sind keine allgemeingültige Rangliste von Plug-ins.

## Schritte

1. Öffnen Sie **Hilfe > CPU profiling**.
2. Starten oder wiederholen Sie die Wiedergabe nach dem Öffnen des Fensters, damit jeder Echtzeiteffekt gemessen werden kann.
3. Beobachten Sie mehrere Aktualisierungen. Vergleichen Sie die Effektzeilen mit der Basiszeile des Editors. Umgehen Sie einen rechenintensiven Effekt und wiederholen Sie denselben Abschnitt.
4. Schließen Sie das Fenster und aktivieren Sie gewünschte Verarbeitung wieder.

## Ergebnis prüfen

Die CPU-Auslastung kann die Kapazität eines einzelnen Kerns überschreiten: 100 % entspricht einem vollständig ausgelasteten CPU-Kern. Vergleichen Sie CPU- und verstrichene Verarbeitungszeit in Prozent. Ein Strich bedeutet, dass keine Messung verfügbar ist, nicht dass der Effekt nichts kostet.

## Grenzen und Wiederherstellung

Die verstrichene Verarbeitungszeit umfasst Planungsverzögerungen. GPU-Nutzung und externe Hilfsprozesse sind ausgenommen; das Profiling selbst verursacht zusätzlichen Aufwand. Ein umgangener Effekt wird separat gekennzeichnet. Öffnen Sie in der Effektkopfzeile **Weitere Optionen > Auto-idle**, damit ein geeigneter Prozessor während der Stille in den Ruhezustand wechseln kann. Deaktivieren Sie die Funktion für Effekte, die ein kontinuierliches Timing benötigen. Weitere Einstellungen finden Sie unter [Lokale Verarbeitung](/help/local-processing/). Spielen Sie beim Vergleichen von Änderungen immer denselben Abschnitt erneut ab.
