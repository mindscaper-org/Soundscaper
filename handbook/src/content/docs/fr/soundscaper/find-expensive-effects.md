---
title: "Repérer les effets qui sollicitent le processeur pendant la lecture"
description: "Comparez le coût des effets en temps réel avant de simplifier le traitement."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"fr"} -->

Comparez le coût des effets en temps réel avant de simplifier le traitement.

## Avant de commencer

Utilisez un projet comportant des effets en temps réel et un passage représentatif chargé. Les mesures décrivent cet appareil et cette charge de travail ; elles ne constituent pas un classement universel des plug-ins.

## Étapes

1. Ouvrez **Aide > CPU profiling**.
2. Après avoir ouvert le panneau, lancez ou relancez la lecture afin de mesurer chaque effet en temps réel.
3. Observez plusieurs mises à jour. Comparez les lignes des effets à celle de l’éditeur de base ; contournez un effet coûteux et rejouez le même passage.
4. Fermez le panneau lorsque vous avez terminé et réactivez les traitements à conserver.

## Vérifier le résultat

L’utilisation du processeur peut dépasser la capacité d’un seul cœur : 100 % correspond à un cœur entièrement occupé. Comparez les pourcentages de processeur et de temps de traitement écoulé. Un tiret indique qu’aucune mesure n’est disponible, et non un coût nul.

## Limites et récupération

Le temps de traitement écoulé comprend les retards de planification. L’utilisation du processeur graphique et les processus auxiliaires externes ne sont pas inclus ; le profilage ajoute lui-même une surcharge. Un effet contourné est signalé séparément. Ouvrez **Plus d'options > Auto-idle** dans l’en-tête d’un effet pour permettre à un processeur adapté de se mettre en veille pendant le silence. Désactivez cette fonction pour les effets qui exigent une synchronisation continue. Consultez [le traitement local](/help/local-processing/) pour les réglages associés. Rejouez toujours le même passage pour comparer les changements.
