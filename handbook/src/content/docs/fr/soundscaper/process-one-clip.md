---
title: "Appliquer des effets en temps réel à un clip"
description: "Attribuez son propre rack d’effets à un clip audio, sans traiter tous les clips de sa piste."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"fr"} -->

Attribuez son propre rack d’effets à un clip audio, sans traiter tous les clips de sa piste.

## Avant de commencer

Sélectionnez un clip audio dans Soundscaper. Les effets du clip font partie de son traitement et alimentent les effets de la piste ; le traitement de la piste et du master peut encore modifier le son entendu.

## Étapes

1. Ouvrez **Fenêtre > Propriétés du clip** et développez **Effets**. Il s’agit du rack d’effets de ce clip.
2. Choisissez **Ajouter un effet**, sélectionnez un effet et réglez-le. Écoutez le clip pour tester le résultat.
3. Utilisez le bouton d’alimentation de l’effet pour comparer le son traité et le son contourné. Réordonnez ou supprimez les effets du rack selon vos besoins.
4. Enregistrez le projet, puis écoutez le clip avec ses voisins. Utilisez **Annuler** si la modification ne convient pas.

## Vérifier le résultat

Le clip sélectionné possède son propre traitement, tandis que les autres clips gardent leurs réglages. Écoutez au-delà de sa fin pour repérer la réverbération ou le délai, puis vérifiez le rack de la piste si l’effet combiné est trop prononcé.

## Limites et récupération

La queue d’un effet peut dépasser la durée de l’audio source du clip ; vérifiez les options de queue à l’exportation avant la livraison. Pour un détecteur Auto Duck, choisissez une autre piste appropriée ; les boucles de retour sont refusées. Ouvrez **Plus d'options > Auto-idle** dans l’en-tête de l’effet pour régler la mise en veille pendant le silence. Désactivez cette fonction pour les plug-ins sensibles à la synchronisation. Consultez [le traitement local](/help/local-processing/) pour les réglages associés.
