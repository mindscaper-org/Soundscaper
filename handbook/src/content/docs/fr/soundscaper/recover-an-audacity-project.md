---
title: "Récupérer l’audio d’un projet Audacity endommagé"
description: "Évaluez un projet endommagé et enregistrez le travail récupéré dans une copie distincte."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"fr"} -->

Évaluez un projet endommagé et enregistrez le travail récupéré dans une copie distincte.

## Avant de commencer

Commencez par copier le projet Audacity endommagé. Conservez ensemble les éventuels fichiers annexes. La récupération peut traiter les fichiers `.aup3` pris en charge et les projets Audacity non enregistrés, mais ne peut pas recréer les échantillons qui n’existent plus.

## Étapes

1. Ouvrez **Fichier > Gestion des projets > Récupérer le projet Audacity**.
2. Sélectionnez le projet endommagé. Lisez l’**Recovery assessment** avant d’importer ou d’enregistrer quoi que ce soit.
3. Examinez les **Missing audio ranges**, y compris les pages supplémentaires des emplacements concernés.
4. Si l’option est disponible, choisissez **Save repaired Audacity copy**. Sinon, ouvrez le résultat récupéré, consultez son rapport de compatibilité et enregistrez votre travail sous un nouveau nom.

## Vérifier le résultat

Écoutez les passages récupérés et comparez les lacunes ou silences avec le rapport. Vérifiez que la nouvelle copie s’ouvre avant de vous y fier. Conservez le fichier endommagé d’origine pour une nouvelle tentative.

## Limites et récupération

La récupération peut sauver les débuts audio valides et remplacer les échantillons manquants par du silence. Une base de données réparée ne signifie pas que tout l’audio a survécu ni que toutes les fonctions de montage natives sont transférées. Consultez la liste des éléments omis et n’écrasez jamais votre seul original pendant le diagnostic. Pour les projets intacts, utilisez le [guide d’importation Audacity](/guides/projects/open-an-audacity-project/).
