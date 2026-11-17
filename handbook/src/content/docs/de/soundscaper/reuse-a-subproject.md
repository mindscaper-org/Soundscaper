---
title: "Ein gespeichertes Projekt als verknüpftes Audio wiederverwenden"
description: "Fügen Sie ein gespeichertes Projekt in ein anderes Arrangement ein und übernehmen Sie spätere Änderungen."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"de"} -->

Fügen Sie ein gespeichertes Projekt in ein anderes Arrangement ein und übernehmen Sie spätere Änderungen.

## Vor dem Start

Speichern Sie das untergeordnete Soundscaper-Projekt in derselben lokalen Projektbibliothek. Stellen Sie den Mix zunächst fertig. Rendern und übernehmen Sie aktive native Plug-in-Verarbeitung in das Audio, bevor Sie den Subprojekt-Renderer im Hintergrund verwenden.

## Schritte

1. Öffnen Sie das übergeordnete Projekt und wählen Sie **Datei > Subprojects**.
2. Wählen Sie unter **Project to insert or relink** das untergeordnete Projekt und dann **Insert subproject**. Der veröffentlichte Mix erscheint auf einer neuen Spur.
3. Wählen Sie den Link unter **Linked subprojects** und klicken Sie auf **Open subproject**, um das untergeordnete Projekt zu bearbeiten. Speichern Sie es und kehren Sie zum übergeordneten Projekt zurück, um das aktualisierte Audio anzuhören.
4. Wählen Sie **Pin current audio**, um diese Fassung zu behalten, oder **Make independent audio**, wenn das Projekt dem untergeordneten Projekt nicht mehr folgen soll.

## Ergebnis prüfen

Die Position im übergeordneten Projekt bleibt beim Aktualisieren des untergeordneten Projekts unverändert. Spielen Sie das Audio nach der Aktualisierung ab und prüfen Sie Anfang und Ende. Ein kürzerer untergeordneter Mix wird innerhalb der ursprünglich veröffentlichten Länge mit Stille aufgefüllt.

## Grenzen und Wiederherstellung

Die veröffentlichte Dauer und Kanalbelegung bleiben fest; für einen anderen Bereich fügen Sie eine weitere Platzierung ein. Eine portable Datei des übergeordneten Projekts enthält das installierte Audio, aber nicht das bearbeitbare untergeordnete Projekt. Übertragen Sie dieses separat und verwenden Sie **Relink to selected project**. Zyklische Verknüpfungen werden abgelehnt.
