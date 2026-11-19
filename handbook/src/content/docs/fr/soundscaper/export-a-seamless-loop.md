---
title: "Exporter une boucle avec les queues d’effets"
description: "Reportez au début d’un fichier audio répétitif la queue d’une réverbération ou d’un délai."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"fr"} -->

Reportez au début d’un fichier audio répétitif la queue d’une réverbération ou d’un délai.

## Avant de commencer

Préparez une plage de boucle exacte avec le traitement souhaité. Utilisez un format sans perte, tel que WAV, pour vérifier la jonction. Évitez l’écrêtage des niveaux de lecture et d’export.

## Étapes

1. Sélectionnez la plage à répéter et ouvrez **Fichier > Exporter l’audio**.
2. Choisissez la plage sélectionnée, un format approprié, la fréquence d’échantillonnage et la disposition des canaux.
3. Dans les réglages d’export, activez **Render as loop**. Exportez le fichier.
4. Importez le résultat dans un projet de test et écoutez plusieurs répétitions, surtout au point de jonction.

## Vérifier le résultat

Le fichier exporté conserve la durée de boucle choisie et reporte la queue rendue à son début. Repérez les clics, les hausses de niveau et la continuité de la réverbération.

## Limites et récupération

Le report de queue ne corrige pas une coupe musicale mal choisie ni une forme d’onde directe discontinue. Cette option diffère de **Inclure les queues d'effet jusqu'à 10 secondes**, qui prolonge un export ordinaire. La somme des queues peut augmenter les crêtes ; baissez le niveau ou utilisez la limitation des crêtes vraies facultative du Limiteur, puis vérifiez le fichier livré. Les formats avec perte peuvent ajouter du remplissage ou modifier les crêtes : vérifiez aussi le format réellement destiné à la livraison.
