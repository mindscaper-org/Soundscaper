---
title: "Importer une session audio d’un autre éditeur"
description: "Importez les montages audio pris en charge, reconnectez leurs médias et examinez les limites de conversion."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"fr"} -->

Importez les montages audio pris en charge, reconnectez leurs médias et examinez les limites de conversion.

## Avant de commencer

Copiez la session et ses fichiers audio dans un dossier accessible. Les formats natifs de session audio pris en charge comprennent REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, les sessions SoundCraft et Audition `.sesx` ou l’ancien format `.ses`. Conservez le projet original.

## Étapes

1. Choisissez **Fichier > Ouvrir** ou **Fichier > Importer**, ou déposez la session dans l’espace de travail.
2. Dans un navigateur, sélectionnez les fichiers audio associés à la session. Sur ordinateur, autorisez l’accès au dossier des médias si la demande apparaît.
3. Ouvrez **Fichier > Rapport de livraison**. Consultez les éléments omis et convertis, puis reliez à nouveau les médias hors ligne si nécessaire.
4. Écoutez des montages et fondus représentatifs, vérifiez l’ordre et le minutage des pistes, puis enregistrez un nouveau projet Scape.

## Vérifier le résultat

Les coupes importées doivent correspondre aux fichiers source accessibles. Comparez le résultat avec un mix de référence issu de l’éditeur d’origine, notamment lorsque le traitement, le routage ou l’automation sont importants.

## Limites et récupération

L’importation native convertit les montages audio ; elle ne garantit pas un mixage identique. Les détails pris en charge varient selon le format ; les plug-ins de la session source ne sont pas exécutés. Pour REAPER, seules les prises audio actives sont utilisées ; la création de prises alternatives, le MIDI, le routage et les plug-ins sont omis. Pour échanger avec un autre DAW, utilisez les formats d’export d’échange pris en charge comme AES31 ADL ou DAWproject plutôt que d’attendre l’écriture d’une session native.
