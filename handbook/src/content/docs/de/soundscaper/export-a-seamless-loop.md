---
title: "Eine Schleife mit ihren Effektfahnen exportieren"
description: "Legen Sie die Fahne eines Halls oder Delays an den Anfang einer sich wiederholenden Audiodatei."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"de"} -->

Legen Sie die Fahne eines Halls oder Delays an den Anfang einer sich wiederholenden Audiodatei.

## Vor dem Start

Bereiten Sie einen exakten Schleifenbereich mit der gewünschten Verarbeitung vor. Verwenden Sie zum Prüfen der Naht ein verlustfreies Format wie WAV. Halten Sie Wiedergabe- und Exportpegel unterhalb der Übersteuerung.

## Schritte

1. Wählen Sie den zu wiederholenden Zeitbereich und öffnen Sie **Datei > Audio exportieren**.
2. Wählen Sie den markierten Bereich sowie ein passendes Format, eine Abtastrate und eine Kanalbelegung.
3. Aktivieren Sie in den Exporteinstellungen **Render as loop** und exportieren Sie die Datei.
4. Importieren Sie das Ergebnis in ein Testprojekt und hören Sie mehrere Wiederholungen an, besonders am Übergang.

## Ergebnis prüfen

Die exportierte Datei behält die gewählte Schleifenlänge bei; die gerenderte Fahne wird an den Anfang gelegt. Achten Sie auf Klicks, Pegelsprünge und einen gleichmäßigen Hallübergang.

## Grenzen und Wiederherstellung

Das Umlegen der Fahne kann weder einen ungeeigneten musikalischen Schnitt noch eine unstetige trockene Wellenform beheben. Die Funktion unterscheidet sich von **Effektfahnen bis 10 Sekunden einbeziehen**, wodurch ein normaler Export verlängert wird. Überlagerte Fahnen können Spitzen erhöhen. Senken Sie den Pegel oder verwenden Sie die optionale True-Peak-Begrenzung des Limiters und prüfen Sie die Ausgabedatei. Verlustbehaftete Formate können Padding hinzufügen oder Pegelspitzen ändern; kontrollieren Sie daher auch das Zielformat.
