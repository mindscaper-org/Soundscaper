---
title: "Desktop-Audio-Plug-ins verwenden"
description: "Finden, aktivieren und testen Sie native Effekte und Instrumente in Soundscaper Desktop."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"de"} -->

Finden, aktivieren und testen Sie native Effekte und Instrumente in Soundscaper Desktop.

## Vor dem Start

Installieren Sie einen Plug-in-Build, der mit Ihrem Betriebssystem und dem unterstützten Host-Format kompatibel ist. Mitgelieferte Desktop-Plug-ins sind in unterstützten Paketen standardmäßig verfügbar; zusätzliche Plug-ins müssen dennoch gefunden und gegebenenfalls ausdrücklich freigegeben werden.

## Schritte

1. Öffnen Sie **Effekt > Plugin-Verwaltung**. Suchen Sie in der Liste und öffnen Sie **Suche und Einstellungen**, um die Suchoptionen festzulegen.
2. Wählen Sie das Plug-in und prüfen Sie Version, Berechtigungen und Wiederherstellungssteuerung. Aktivieren Sie es bei Bedarf.
3. Fügen Sie einen Effekt über **Effekt > Audio-Plugins** oder ein Echtzeit-Rack hinzu. Wählen Sie native Instrumente über die Instrumentsteuerung der MIDI-Spur.
4. Hören Sie das Ergebnis ab, speichern Sie bei Bedarf eine Voreinstellung und sichern Sie das Projekt.

## Über einen Gitarrenverstärker spielen

Fügen Sie **OrbitAmp** über **Effekt > Audio-Plugins** oder das Echtzeit-Effekt-Rack einer Spur hinzu. Öffnen Sie den Plug-in-Editor und wählen Sie im Bereich **AMP** einen Verstärker und unter **CAB** eine Lautsprecherbox. Das Desktop-Paket enthält die Werkssounds.

## Ergebnis prüfen

Das gewünschte Plug-in sollte den Klang bearbeiten und seine gespeicherten Einstellungen beim erneuten Laden wiederherstellen, sofern dasselbe kompatible Binärprogramm vorhanden ist. Umgehen Sie es zum Vergleich und kontrollieren Sie den Export vor der Ausgabe.

## Grenzen und Wiederherstellung

Windows-Pakete unterstützen die gepflegten VST2-Bridge-Wege einschließlich unterstützter 32-Bit-Plug-ins. Unter Linux ist Windows-VST3 über eine installierte und konfigurierte yabridge/Wine-Umgebung möglich; dadurch werden Plug-ins von Drittanbietern weder installiert noch lizenziert. Plug-in-Voreinstellungen enthalten keine Binärdateien. Falls ein Plug-in fehlschlägt, verwenden Sie die Wiederherstellungssteuerung im Plug-in-Manager und versuchen Sie eine kompatible Version, bevor Sie weiterarbeiten.
