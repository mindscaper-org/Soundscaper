---
title: "Couper l’audio parlé depuis sa transcription"
description: "Sélectionnez les mots d’une transcription minutée pour parcourir et monter l’audio correspondant."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","targetLocale":"fr"} -->

Sélectionnez les mots d’une transcription minutée pour parcourir et monter l’audio correspondant.

## Avant de commencer

Ouvrez un projet contenant des paroles. La génération d’une nouvelle transcription exige l’application de bureau, un modèle local compatible installé et votre consentement explicite. Une transcription déjà minutée peut être utilisée sans la générer de nouveau.

## Étapes

1. Ouvrez **Édition > Transcript-based editing**.
2. Si l’option est disponible, choisissez **Generate transcript**, puis suivez les demandes concernant le modèle et les autorisations. Attendez que le traitement des pistes audio se termine.
3. Cliquez sur un mot pour accéder à son audio. Double-cliquez sur un mot pour le sélectionner, puis vérifiez la plage surlignée dans la timeline.
4. Lorsque la transcription est active, appuyez sur **Backspace** ou **Supprimer** pour supprimer les mots sélectionnés et l’audio associé. Écoutez la jonction et utilisez **Annuler** si nécessaire.

## Vérifier le résultat

La transcription et le montage audio sont synchronisés ; le passage sélectionné devient visible sans modifier le zoom. Enregistrez le projet, fermez le panneau puis rouvrez-le pour continuer à travailler sur la transcription conservée.

## Limites et récupération

La transcription et le minutage des mots peuvent être erronés : écoutez avant de supprimer. Dans l’éditeur Web, un message indique que la génération est réservée à l’application de bureau ; aucun modèle n’est téléchargé ou exécuté. La transcription est une aide au montage, pas un compte rendu mot à mot garanti. Conservez un [instantané](/soundscaper/save-session-snapshots/) avant les coupes importantes dans un dialogue.
