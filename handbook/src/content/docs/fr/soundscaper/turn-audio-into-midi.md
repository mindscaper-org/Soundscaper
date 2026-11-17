---
title: "Convertir des notes enregistrées en MIDI modifiable"
description: "Analysez un enregistrement musical avec Basic Pitch et conservez des notes modifiables à côté de l’audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"fr"} -->

Analysez un enregistrement musical avec Basic Pitch et conservez des notes modifiables à côté de l’audio.

## Avant de commencer

Utilisez Soundscaper pour ordinateur avec le modèle Basic Pitch publié et son moteur d’exécution compatible installés. Commencez par une courte sélection musicale aux hauteurs clairement définies. Conservez l’audio comme référence d’écoute.

## Étapes

1. Sélectionnez l’audio musical et ouvrez **Outils > Traitement local avancé**.
2. Réglez **Opération** sur **Audio to MIDI (Basic Pitch)**. Confirmez tout consentement requis au traitement local, puis choisissez **Analyser**.
3. Choisissez **Examiner le résultat**, examinez les notes détectées et sélectionnez **Accepter la proposition** lorsque vous êtes prêt.
4. Ouvrez **Fenêtre > Piano roll (beta)**, sélectionnez le nouveau contenu MIDI et corrigez les hauteurs, le minutage et la durée des notes.

## Vérifier le résultat

Une nouvelle piste MIDI apparaît à côté de l’audio d’origine. Choisissez un instrument et écoutez-le avec l’enregistrement. **Annuler** retire la proposition acceptée sans supprimer l’audio source.

## Limites et récupération

Les notes détectées sont des estimations, surtout dans les mixages denses ou les enregistrements bruités. Le MIDI décrit les notes, pas le timbre d’origine. Utilisez les [instruments MIDI](/soundscaper/play-midi-instruments/) pour la lecture et **Fichier > Autres exportations > Export MIDI (beta)** pour partager les notes. Les destinataires doivent disposer d’un instrument capable de reproduire le son voulu.
