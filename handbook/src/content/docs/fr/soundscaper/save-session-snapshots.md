---
title: "Enregistrer et restaurer un instantané de session"
description: "Conservez une version nommée d’un arrangement avant d’essayer un autre montage."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","targetLocale":"fr"} -->

Conservez une version nommée d’un arrangement avant d’essayer un autre montage.

## Avant de commencer

Ouvrez un projet Soundscaper modifiable contenant l’audio à conserver. Un instantané appartient à ce projet ; enregistrez aussi un fichier de projet portable pour disposer d’une sauvegarde séparée.

## Étapes

1. Ouvrez **Fichier > Session snapshots**.
2. Saisissez un **Snapshot name**, par exemple « Avant les coupes de dialogue », puis choisissez **Create snapshot**. Fermez la boîte de dialogue et effectuez vos modifications.
3. Pour revenir à cette version, rouvrez la boîte de dialogue, sélectionnez-la dans **Saved snapshots**, puis choisissez **Restore snapshot**.
4. Utilisez **Rename snapshot** pour préciser le nom d’une version ou **Delete snapshot** pour en retirer une dont vous n’avez plus besoin.

## Vérifier le résultat

L’arrangement précédent et l’audio qu’il conservait sont restaurés. Fermez la boîte de dialogue et écoutez le passage restauré. **Annuler** inverse la restauration ; **Rétablir** la réapplique.

## Limites et récupération

Un instantané est un état nommé du projet, pas une sauvegarde externe. Il peut conserver de l’audio supprimé de l’arrangement actuel et occupe donc de l’espace. Supprimer un instantané ne modifie pas l’arrangement courant. Consultez [les sauvegardes de projet](/projects-and-data/storage-backups-and-privacy/).
