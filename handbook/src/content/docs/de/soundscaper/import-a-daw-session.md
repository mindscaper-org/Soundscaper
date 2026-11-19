---
title: "Eine Audiositzung aus einem anderen Editor importieren"
description: "Importieren Sie unterstützte Audiobearbeitungen, verbinden Sie deren Medien neu und prüfen Sie die Konvertierungsgrenzen."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"de"} -->

Importieren Sie unterstützte Audiobearbeitungen, verbinden Sie deren Medien neu und prüfen Sie die Konvertierungsgrenzen.

## Vor dem Start

Kopieren Sie die Sitzung und die zugehörigen Audiodateien in einen zugänglichen Ordner. Unterstützte native Audio-Sitzungsimporte sind REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, SoundCraft-Sitzungen sowie Audition `.sesx` oder das ältere `.ses`. Bewahren Sie das Originalprojekt auf.

## Schritte

1. Wählen Sie **Datei > Öffnen** oder **Datei > Importieren**, oder ziehen Sie die Sitzung in den Arbeitsbereich.
2. Wählen Sie im Browser die zugehörigen Audiodateien mit der Sitzung aus. Erteilen Sie auf dem Desktop bei Aufforderung Zugriff auf den Medienordner.
3. Öffnen Sie **Datei > Auslieferungsbericht**. Lesen Sie die Auslassungen und Konvertierungen, und verknüpfen Sie bei Bedarf offline befindliche Medien erneut.
4. Hören Sie beispielhafte Schnitte und Fades an, prüfen Sie Spurfolge und Timing und speichern Sie ein neues Scape-Projekt.

## Ergebnis prüfen

Die importierten Schnitte sollten mit den zugänglichen Quelldateien übereinstimmen. Vergleichen Sie das Ergebnis mit einem Referenzmix aus dem ursprünglichen Editor, besonders wenn Verarbeitung, Routing oder Automation eine Rolle spielen.

## Grenzen und Wiederherstellung

Der native Import konvertiert Audiobearbeitungen und garantiert keinen identischen Mix. Der unterstützte Detailumfang variiert je Format; Plug-ins aus der Quellsitzung werden nicht ausgeführt. REAPER verwendet aktive Audio-Takes und lässt das Erstellen alternativer Takes, MIDI, Routing und Plug-ins aus. Für den Austausch mit einer anderen DAW nutzen Sie unterstützte Austauschformate wie AES31 ADL oder DAWproject, statt einen nativen Sitzungsexport zu erwarten.
