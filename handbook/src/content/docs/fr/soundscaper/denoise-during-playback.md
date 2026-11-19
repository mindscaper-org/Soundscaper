---
title: "Réduire le bruit pendant la lecture"
description: "Ajoutez un effet de débruitage IA en temps réel à une piste de dialogue."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"fr"} -->

Ajoutez un effet de débruitage IA en temps réel à une piste de dialogue.

## Avant de commencer

Utilisez Soundscaper pour ordinateur. Ouvrez **Outils > Gestionnaire de modèles** et installez le modèle de débruitage en temps réel correspondant ainsi que le moteur d’exécution proposé par votre version. L’installation du modèle est un téléchargement explicite ; un navigateur seul ne peut pas exécuter cet effet natif.

## Étapes

1. Sélectionnez la piste de dialogue bruitée et ouvrez son rack d’effets en temps réel.
2. Choisissez **Ajouter un effet** et sélectionnez **AI denoising (DPDFNet2)**.
3. Lancez la lecture et comparez le son avec l’effet contourné à l’aide de son bouton d’alimentation.
4. Ajustez le mix autour de la piste nettoyée et écoutez l’export avant la livraison. Enregistrez le projet pour conserver le rack.

## Vérifier le résultat

Le bruit doit diminuer tandis que les paroles restent intelligibles. Vérifiez les consonnes faibles, les respirations et le début de la lecture. Si le son pompe ou que des paroles disparaissent, contournez l’effet et comparez avec l’original.

## Limites et récupération

Il s’agit d’un débruitage de la parole, pas d’un effet général de restauration musicale. Pour lire le projet sur un autre ordinateur, il faut y installer le modèle compatible et le moteur natif. Si l’effet est indisponible, vérifiez l’installation et la prise en charge sur ordinateur ; pour obtenir un résultat rendu et vérifié, utilisez la [restauration vocale hors ligne](/soundscaper/restore-damaged-speech/). Le téléchargement d’un modèle ne garantit pas une amélioration de chaque enregistrement.
