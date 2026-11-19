---
title: "Den Klang während der Wiedergabe untersuchen"
description: "Verwenden Sie das Analysefenster für Live-Spektrum, Lautheit, Stereoprüfungen und einen ACX-Audiobericht."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"de"} -->

Verwenden Sie das Analysefenster für Live-Spektrum, Lautheit, Stereoprüfungen und einen ACX-Audiobericht.

## Vor dem Start

Öffnen Sie ein Projekt mit Audio. Entscheiden Sie, ob Sie die Wiedergabe oder einen ausgewählten Bereich untersuchen möchten: Eine Zeitauswahl kann die Spektrumanalyse auf die Auswahl umschalten.

## Schritte

1. Öffnen Sie **Analyse > Analyse**. Klappen Sie benötigte Abschnitte auf, etwa **Spectrum**, Spektrogramm, Lautheit oder Korrelation.
2. Heben Sie die Zeitauswahl auf und starten Sie die Wiedergabe für eine Live-Ansicht. Vergleichen Sie die Spurüberlagerungen im Spektrum, um konkurrierende Frequenzbänder zu finden.
3. Stoppen Sie die Wiedergabe und wählen Sie einen Abschnitt aus, um dessen Spektrum ohne Wiedergabe zu untersuchen.
4. Für Hörbuchprüfungen klappen Sie **ACX-Konformität** auf und wählen **Audio prüfen**. Lesen Sie die Ergebnistabelle; über **Export** erhalten Sie den JSON-Bericht.

## Ergebnis prüfen

Die Live-Anzeigen reagieren auf die Wiedergabe. Ein ACX-Bericht weist die jeweiligen Audioprüfungen als bestanden oder nicht bestanden aus, statt nur einen Pegel anzuzeigen. Korrigieren Sie beanstandete Pegel oder Formateinstellungen und prüfen Sie erneut.

## Grenzen und Wiederherstellung

Ein Spektrum zeigt Energie, nicht die Klangqualität des Mixes. Korrelation und Lautheit müssen im Kontext und durch Hören bewertet werden. ACX-Audioprüfungen garantieren keine Annahme durch einen Veröffentlichungsdienst und decken nicht alle redaktionellen Anforderungen ab. Beim Zuklappen des ACX-Abschnitts wird die Anzeige gelöscht; führen Sie die Prüfung bei Bedarf erneut aus. Schließen Sie nicht benötigte Analyseabschnitte, um den Anzeigeaufwand zu senken.
