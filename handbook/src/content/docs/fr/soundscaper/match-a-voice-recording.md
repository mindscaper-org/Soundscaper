---
title: "Harmoniser la tonalité d’un enregistrement vocal"
description: "Apprenez une référence tonale et utilisez Match EQ pour rapprocher un autre enregistrement de celle-ci."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"fr"} -->

Apprenez une référence tonale et utilisez Match EQ pour rapprocher un autre enregistrement de celle-ci.

## Avant de commencer

Choisissez une référence audible à bande passante complète, d’au moins un quart de seconde, de préférence le même locuteur enregistré dans de bonnes conditions. Préparez l’enregistrement cible. Le traitement local est utilisé dans le navigateur comme sur ordinateur.

## Étapes

1. Sélectionnez la référence et ouvrez **Effet > Égalisation et filtres > Match EQ**. Choisissez **Learn reference from selection**.
2. Enregistrez la référence apprise comme préréglage si vous souhaitez réutiliser ce profil vocal. Fermez la boîte de dialogue.
3. Sélectionnez la cible, rouvrez Match EQ, rappelez la référence au besoin, puis choisissez **Analyze target**.
4. Avec **Original**, comparez **Matched (level compensated)** et **Aperçu**. Réglez la correction, puis choisissez **Appliquer sur la sélection** ou **Edit as Filter Curve EQ** pour ajuster la courbe.

## Vérifier le résultat

Écoutez à un volume similaire pour comparer l’équilibre tonal. L’audio traité conserve sa durée et son nombre de canaux. **Annuler** annule l’application.

## Limites et récupération

Match EQ ne peut pas restaurer une bande passante absente ni reproduire l’interprétation, la dynamique, la réverbération de la pièce ou l’identité de la voix. La capture de référence inclut les effets de piste avant les bus et le master ; la cible est analysée avant son rack de piste. Effectuez d’abord le rendu de la référence si le son souhaité dépend du traitement en aval.
