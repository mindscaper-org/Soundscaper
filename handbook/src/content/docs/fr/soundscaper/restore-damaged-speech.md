---
title: "Restaurer une voix endommagée avec un modèle local"
description: "Écoutez le résultat facultatif de restauration vocale avant de l’appliquer à votre enregistrement."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","targetLocale":"fr"} -->

Écoutez le résultat facultatif de restauration vocale avant de l’appliquer à votre enregistrement.

## Avant de commencer

Utilisez l’application de bureau et sélectionnez le passage vocal à réparer. Conservez l’original ou un instantané. Les modèles proposés pour cette tâche dépendent du catalogue publié et du moteur d’exécution installé ; votre version peut ne pas proposer VoiceFixer.

## Étapes

1. Ouvrez **Effet > Réparation et suppression du bruit > Amélioration du dialogue**.
2. Choisissez un **Modèle** compatible. Si **VoiceFixer** est proposé, il cible l’écrêtage et la restauration de la parole ; installez-le explicitement via les commandes des modèles au besoin.
3. Lancez le traitement, puis choisissez **Examiner le résultat** et écoutez l’audio proposé à côté de l’original.
4. N’acceptez le résultat que si les paroles sont améliorées. Vérifiez l’emplacement choisi avant de l’appliquer et enregistrez le projet.

## Vérifier le résultat

Écoutez les crêtes réparées et la clarté de la voix, mais aussi les voyelles, les respirations et l’ambiance modifiées. Le résultat accepté est un montage audio que vous pouvez écouter et annuler ; refuser ou fermer la vérification ne l’applique pas.

## Limites et récupération

VoiceFixer resynthétise la parole et peut modifier le timbre et le fond sonore. Ce n’est pas un outil général pour réparer l’écrêtage musical. S’il n’apparaît pas dans le sélecteur de modèles, utilisez un améliorateur proposé ou le [guide de réparation des crêtes écrêtées](/guides/cleaning-up/restore-clipped-peaks/) classique ; ces étapes ne permettent pas d’activer un modèle absent.
