---
title: "Ein ADM-Programm für Lautsprecher rendern"
description: "Exportieren Sie selbst erstellte ADM-Beds und -Objekte mit EBU EAR als gewöhnliches Lautsprecher-Audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"de"} -->

Exportieren Sie selbst erstellte ADM-Beds und -Objekte mit EBU EAR als gewöhnliches Lautsprecher-Audio.

## Vor dem Start

Erstellen Sie ein ADM-Programm im ADM-Reiter des Metadateneditors, mit Bed-Zuweisungen und positionierten Objekten. Legen Sie die Lautsprecheranordnung für die Ausgabe fest und wählen Sie einen Container und Codec, die genug Kanäle unterstützen.

## Schritte

1. Öffnen Sie **Datei > Audio exportieren**.
2. Wählen Sie unter **Rendern > EBU EAR speaker rendering** eine Anordnung: Stereo, 5.1, 5.1.2, 5.1.4, 7.1 oder 7.1.4.
3. Prüfen Sie Ausgabeformat, Kanalanzahl und Pegel und exportieren Sie die Datei.
4. Lesen Sie den Auslieferungsbericht und hören Sie die exportierte Datei über die passende Lautsprecheranordnung ab.

## Ergebnis prüfen

Die Ausgabe enthält gerendertes Lautsprecher-PCM in der angegebenen Kanalreihenfolge. Diese Exportoption ändert weder die Projekt-Abhörkontrolle noch das ursprüngliche ADM-Authoring. Im Bericht sehen Sie verwendeten Renderer und Layout.

## Grenzen und Wiederherstellung

EAR-Lautsprecher-Rendering ist nicht mit Kopfhörer-Rendering kombinierbar. Getrennte Ausgaben und BW64/ADM-Passthrough können diese Option nicht verwenden. Gerenderte Kanäle enthalten nicht die ursprünglichen ADM-Metadaten zu bed/object; verwenden Sie für diesen Austausch ungerendertes BW64. Bewegte oder diffuse Objekte, HOA, Bassmanagement und zertifiziertes Dolby-Rendering liegen außerhalb dieser Funktion. Der gewöhnliche Lautheitsmesser unterstützt höchstens acht Ausgabekanäle.
