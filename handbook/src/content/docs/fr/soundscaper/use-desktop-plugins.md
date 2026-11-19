---
title: "Utiliser les plug-ins audio de la version de bureau"
description: "Recherchez, activez et écoutez les effets et instruments natifs dans Soundscaper pour ordinateur."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","targetLocale":"fr"} -->

Recherchez, activez et écoutez les effets et instruments natifs dans Soundscaper pour ordinateur.

## Avant de commencer

Installez une version du plug-in compatible avec votre système d’exploitation et un format d’hôte pris en charge. Les plug-ins inclus dans l’application de bureau sont disponibles par défaut dans les paquets compatibles ; les plug-ins supplémentaires nécessitent toujours une recherche et les autorisations requises.

## Étapes

1. Ouvrez **Effet > Gestionnaire de plugins**. Recherchez le plug-in et utilisez **Analyse et paramètres des effets** pour régler la découverte.
2. Sélectionnez le plug-in et vérifiez sa version, ses autorisations et ses options de récupération. Activez-le si nécessaire.
3. Ajoutez un effet via **Effet > Effets des plugins audio** ou un rack en temps réel. Sélectionnez les instruments natifs avec les commandes d’instrument de la piste MIDI.
4. Écoutez le résultat, enregistrez un préréglage si utile, puis enregistrez le projet.

## Vérifier le résultat

Le plug-in voulu doit traiter le son et retrouver ses paramètres enregistrés si le même binaire compatible est disponible. Contournez-le pour comparer et vérifiez l’export avant la livraison.

## Limites et récupération

Les paquets Windows prennent en charge les chemins de pontage VST2 maintenus, y compris les plug-ins 32 bits pris en charge. Sous Linux, les VST3 Windows peuvent fonctionner avec une configuration yabridge/Wine installée ; cette configuration n’installe pas et ne fournit pas de licence pour les plug-ins tiers. Les préréglages n’incluent pas les binaires. Si un plug-in échoue, utilisez les commandes de récupération du Gestionnaire de plug-ins et essayez une version compatible avant de reprendre le travail.
