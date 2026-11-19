---
title: "Exporter un programme ADM pour haut-parleurs"
description: "Exportez des lits et objets ADM créés par vos soins en audio ordinaire pour haut-parleurs avec EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"fr"} -->

Exportez des lits et objets ADM créés par vos soins en audio ordinaire pour haut-parleurs avec EBU EAR.

## Avant de commencer

Créez un programme ADM dans l’onglet ADM de l’éditeur de métadonnées, avec les affectations de lits et les objets positionnés. Déterminez la disposition des haut-parleurs de livraison et choisissez un conteneur et un codec adaptés au nombre de canaux.

## Étapes

1. Ouvrez **Fichier > Exporter l’audio**.
2. Sous **Rendu > EBU EAR speaker rendering**, choisissez une disposition : stéréo, 5.1, 5.1.2, 5.1.4, 7.1 ou 7.1.4.
3. Vérifiez le format de sortie, le nombre de canaux et les réglages de niveau, puis exportez.
4. Lisez le rapport de livraison et écoutez le fichier exporté sur la disposition de haut-parleurs correspondante.

## Vérifier le résultat

La sortie contient de l’audio PCM rendu pour haut-parleurs dans l’ordre de canaux déclaré. Ce choix d’export ne change ni l’écoute de contrôle du projet ni la création ADM d’origine. Consultez le rapport pour connaître le moteur de rendu et la disposition employés.

## Limites et récupération

Le rendu EAR pour haut-parleurs ne peut pas être combiné au rendu pour casque. Les sorties séparées et le transfert direct BW64/ADM ne permettent pas cette option. Les canaux rendus ne contiennent pas les métadonnées ADM d’origine relatives à bed/object ; utilisez un fichier BW64 non rendu pour cet échange. Les objets mobiles ou diffus, le HOA, la gestion des basses et le rendu Dolby certifié ne sont pas pris en charge par cette fonctionnalité. Le sonomètre ordinaire prend en charge au maximum huit canaux livrés.
