---
title: "Réutiliser un projet enregistré comme audio lié"
description: "Insérez un projet enregistré dans un autre arrangement et suivez ses modifications ultérieures."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"fr"} -->

Insérez un projet enregistré dans un autre arrangement et suivez ses modifications ultérieures.

## Avant de commencer

Enregistrez le projet Soundscaper enfant dans la même bibliothèque de projets locale. Terminez d’abord son mixage. Effectuez le rendu et validez dans l’audio tout traitement actif de plug-in natif avant d’utiliser le moteur de rendu de sous-projet en arrière-plan.

## Étapes

1. Ouvrez le projet parent et choisissez **Fichier > Subprojects**.
2. Sélectionnez le projet enfant dans **Project to insert or relink**, puis choisissez **Insert subproject**. Son mix publié apparaît sur une nouvelle piste.
3. Sélectionnez le lien dans **Linked subprojects**, puis choisissez **Open subproject** pour modifier l’enfant. Enregistrez-le, puis revenez au parent pour écouter l’audio actualisé.
4. Choisissez **Pin current audio** pour conserver cette version ou **Make independent audio** pour cesser de suivre le projet enfant.

## Vérifier le résultat

La position du parent reste fixe lorsque l’enfant est actualisé. Après l’actualisation, écoutez le passage et vérifiez son début et sa fin. Si le mix de l’enfant est plus court, du silence complète la plage publiée initiale.

## Limites et récupération

La durée publiée et la disposition des canaux restent fixes ; insérez une autre occurrence pour utiliser une autre plage. Un fichier parent portable inclut l’audio installé, mais pas le projet enfant modifiable. Transférez ce dernier séparément et utilisez **Relink to selected project**. Les liens circulaires sont refusés.
