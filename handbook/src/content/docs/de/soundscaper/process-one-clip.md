---
title: "Echtzeiteffekte auf einen Clip anwenden"
description: "Geben Sie einem Audioclip ein eigenes Effekt-Rack, ohne alle Clips seiner Spur zu bearbeiten."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"de"} -->

Geben Sie einem Audioclip ein eigenes Effekt-Rack, ohne alle Clips seiner Spur zu bearbeiten.

## Vor dem Start

Wählen Sie in Soundscaper einen Audioclip aus. Clip-Effekte gehören zur Verarbeitung dieses Clips und speisen die Spur-Effekte; die Verarbeitung der Spur und des Masters kann den Klang weiterhin beeinflussen.

## Schritte

1. Öffnen Sie **Fenster > Clip-Eigenschaften** und klappen Sie **Effekte** auf. Das ist das Effekt-Rack des Clips.
2. Wählen Sie **Effekt hinzufügen**, wählen Sie einen Effekt und passen Sie seine Einstellungen an. Spielen Sie den Clip zur Kontrolle ab.
3. Vergleichen Sie mit der Ein-/Aus-Schaltfläche des Effekts den umgangenen mit dem verarbeiteten Klang. Ordnen Sie Effekte im Rack neu oder entfernen Sie sie bei Bedarf.
4. Speichern Sie das Projekt und hören Sie den Clip zusammen mit den benachbarten Clips an. Verwenden Sie **Rückgängig**, wenn die Änderung nicht hilft.

## Ergebnis prüfen

Der gewählte Clip wird separat verarbeitet, während andere Clips ihre eigenen Einstellungen behalten. Achten Sie über das Clipende hinaus auf Hall- oder Delay-Fahnen. Prüfen Sie das Spuren-Rack, falls die kombinierte Wirkung zu stark ist.

## Grenzen und Wiederherstellung

Eine Effektfahne kann länger als das Quellaudio des Clips sein; prüfen Sie vor der Ausgabe die Exportoptionen für Effektfahnen. Wählen Sie für einen Auto-Duck-Detektor eine andere geeignete Spur; Rückkopplungsschleifen werden abgelehnt. Öffnen Sie in der Effektkopfzeile **Weitere Optionen > Auto-idle**, um den Ruhezustand während der Stille zu steuern. Deaktivieren Sie die Funktion für zeitempfindliche Plug-ins. Weitere Einstellungen finden Sie unter [Lokale Verarbeitung](/help/local-processing/).
