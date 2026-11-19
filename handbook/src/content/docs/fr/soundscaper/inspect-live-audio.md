---
title: "Analyser le son pendant la lecture"
description: "Utilisez le panneau Analyse pour le spectre et le volume en direct, les contrôles stéréo et un rapport audio ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"fr"} -->

Utilisez le panneau Analyse pour le spectre et le volume en direct, les contrôles stéréo et un rapport audio ACX.

## Avant de commencer

Ouvrez un projet contenant de l’audio. Décidez si vous souhaitez examiner la lecture ou une plage sélectionnée : une sélection temporelle peut faire passer le spectre en mode d’analyse de la sélection.

## Étapes

1. Ouvrez **Analyser > Analyse**. Développez les sections utiles, comme **Spectrum**, le spectrogramme, le volume ou la corrélation.
2. Effacez la sélection temporelle et lancez la lecture pour obtenir une vue en direct. Comparez les superpositions des pistes dans le spectre pour repérer des bandes de fréquences concurrentes.
3. Arrêtez la lecture et sélectionnez un passage pour examiner son spectre sans lecture.
4. Pour vérifier un livre audio, développez **ACX compliance** et choisissez **Check audio**. Consultez le tableau de résultats et utilisez **Exporter** pour obtenir le rapport JSON.

## Vérifier le résultat

Les affichages en direct réagissent à la lecture. Un rapport ACX indique la réussite ou l’échec de ses contrôles audio, au lieu de simplement afficher un niveau. Corrigez les niveaux ou les réglages de format en échec, puis relancez la vérification.

## Limites et récupération

Un spectre montre l’énergie, pas la qualité sonore du mix. La corrélation et le volume nécessitent du contexte et une écoute. Les contrôles audio ACX ne garantissent pas l’acceptation par une plateforme de publication et ne couvrent pas toutes les exigences éditoriales. Réduire la section ACX efface le résultat affiché ; relancez le contrôle au besoin. Fermez les sections d’analyse inutilisées pour réduire le travail d’affichage.
