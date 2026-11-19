---
title: "Aligner une nouvelle prise de dialogue"
description: "Adaptez une deuxième interprétation des mêmes mots à un clip de référence."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","targetLocale":"fr"} -->

Adaptez une deuxième interprétation des mêmes mots à un clip de référence.

## Avant de commencer

Préparez deux clips audio mono ou stéréo déverrouillés de 0,25 à 30 secondes. Ils doivent contenir les mêmes mots et une interprétation assez similaire. Effectuez d’abord le rendu ou dissociez les éléments liés à la vidéo ou ancrés aux temps musicaux.

## Étapes

1. Ouvrez **Édition > Clips audio > Align dialogue**.
2. Choisissez explicitement la référence et la nouvelle prise, puis réglez la force de l’alignement.
3. Choisissez **Analyze and align**. Comparez **Play reference**, **Play replacement** et **Play aligned**. Soyez attentif aux consonnes et aux respirations.
4. Choisissez **Create aligned copy** uniquement si le résultat vous convient.

## Vérifier le résultat

Une nouvelle piste contient une copie alignée au début et à la durée de la référence. Les originaux restent disponibles. **Annuler** supprime la copie créée en une étape. Enregistrez puis rouvrez le projet pour réutiliser le résultat rendu sans refaire l’analyse.

## Limites et récupération

La nouvelle prise doit durer entre la moitié et le double de la référence. L’alignement est acoustique : il n’analyse pas les lèvres et ne vérifie pas la transcription. Des paroles différentes, du bruit de fond ou des locuteurs qui se chevauchent peuvent le mettre en échec. Si l’analyse ne trouve pas de correspondance, utilisez des phrases plus courtes et similaires ou effectuez le montage manuellement. Toute modification des entrées ou de la force impose une nouvelle analyse.
