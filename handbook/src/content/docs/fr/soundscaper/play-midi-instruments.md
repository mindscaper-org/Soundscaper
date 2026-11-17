---
title: "Lire du MIDI avec un instrument"
description: "Choisissez un synthétiseur pour les notes MIDI tout en conservant l’interprétation modifiable."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"fr"} -->

Choisissez un synthétiseur pour les notes MIDI tout en conservant l’interprétation modifiable.

## Avant de commencer

Ouvrez ou importez un fichier MIDI, ou créez une piste dans Soundscaper. Les options de lecture intégrées varient selon les instruments natifs facultatifs. Les instruments sous forme de plug-ins natifs exigent l’application de bureau et le plug-in correspondant activé.

## Étapes

1. Pour créer une piste, choisissez **Menu des pistes > Ajouter une nouvelle piste > MIDI track (beta)**.
2. Ouvrez **Fenêtre > Piano roll (beta)**. Ajoutez des notes ou sélectionnez du contenu MIDI existant.
3. Choisissez **Instrument**. Pour un instrument natif, ouvrez **Instrument settings** afin d’en régler le son et d’enregistrer un préréglage.
4. Lancez la lecture, vérifiez les notes et leur maintien, puis enregistrez et rouvrez le projet.

## Vérifier le résultat

Vous devez entendre l’instrument choisi tandis que les notes restent modifiables dans le rouleau de piano. Les paramètres de l’instrument et les préréglages doivent être restaurés à la réouverture si le plug-in requis est installé.

## Limites et récupération

Les instruments natifs sont proposés sur les pistes MIDI, pas sur les pistes audio ordinaires. Un préréglage enregistré n’inclut ni le binaire du plug-in ni ses bibliothèques externes. Les instruments fournis sont activés par défaut dans les paquets de bureau compatibles ; d’autres instruments peuvent nécessiter le [Gestionnaire de plug-ins](/soundscaper/use-desktop-plugins/). Vérifiez la lecture et l’export sur l’ordinateur destinataire avant de compter sur le même timbre.
