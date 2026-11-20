---
title: "Utiliser les plug-ins audio de la version de bureau"
description: "Recherchez, activez et écoutez les effets et instruments natifs dans Soundscaper pour ordinateur."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"fr"} -->

Recherchez, activez et écoutez les effets et instruments natifs dans Soundscaper pour ordinateur.

## Avant de commencer

Installez une version du plug-in compatible avec votre système d’exploitation et un format d’hôte pris en charge. Les plug-ins inclus dans l’application de bureau sont disponibles par défaut dans les paquets compatibles ; les plug-ins supplémentaires nécessitent toujours une recherche et les autorisations requises.

## Étapes

1. Ouvrez **Effet > Gestionnaire de plugins**. Recherchez le plug-in et utilisez **Analyse et paramètres des effets** pour régler la découverte.
2. Sélectionnez le plug-in et vérifiez sa version, ses autorisations et ses options de récupération. Activez-le si nécessaire.
3. Ajoutez un effet via **Effet > Effets des plugins audio** ou un rack en temps réel. Sélectionnez les instruments natifs avec les commandes d’instrument de la piste MIDI.
4. Écoutez le résultat, enregistrez un préréglage si utile, puis enregistrez le projet.

## Jouer avec un ampli de guitare

Ajoutez **OrbitAmp** depuis **Effet > Effets des plugins audio** ou depuis le rack d’effets en temps réel d’une piste. Ouvrez l’éditeur du greffon et choisissez un ampli dans la section **AMP** et un baffle dans la section **CAB**. Le paquet pour ordinateur inclut les sons d’usine.

## Vérifier le résultat

Le plug-in voulu doit traiter le son et retrouver ses paramètres enregistrés si le même binaire compatible est disponible. Contournez-le pour comparer et vérifiez l’export avant la livraison.

## Limites et récupération

Les paquets Windows prennent en charge les chemins de pontage VST2 maintenus, y compris les plug-ins 32 bits pris en charge. Sous Linux, les VST3 Windows peuvent fonctionner avec une configuration yabridge/Wine installée ; cette configuration n’installe pas et ne fournit pas de licence pour les plug-ins tiers. Les préréglages n’incluent pas les binaires. Si un plug-in échoue, utilisez les commandes de récupération du Gestionnaire de plug-ins et essayez une version compatible avant de reprendre le travail.
