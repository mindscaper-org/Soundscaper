---
title: "Réduire les fuites entre microphones de dialogue"
description: "Créez des enveloppes de gain modifiables pour atténuer les fuites corrélées sur les micros inactifs."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"fr"} -->

Créez des enveloppes de gain modifiables pour atténuer les fuites corrélées sur les micros inactifs.

## Avant de commencer

Utilisez de deux à huit pistes de dialogue alignées dans le temps, idéalement un microphone par personne avec des gains d’enregistrement comparables. Sélectionnez une plage temporelle positive contenant de l’audio sur chaque piste choisie. Déverrouillez ces pistes et retirez leur gel.

## Étapes

1. Sélectionnez les pistes de microphone et le passage à traiter.
2. Ouvrez **Effet > Réparation et suppression du bruit > Automatic microphone-bleed reduction**.
3. Commencez avec les réglages par défaut et choisissez **Create gain envelopes**.
4. Écoutez le passage, en particulier les interruptions et les paroles qui se chevauchent. Utilisez le **Gain du clip** pour corriger les points générés qui atténuent des paroles utiles.

## Vérifier le résultat

Les points de gain réduisent les fuites tout en conservant les sources originales et la position des clips. Vérifiez les prises de parole de chaque personne et les limites de la sélection. **Annuler** retire l’opération ; **Rétablir** la réapplique.

## Limites et récupération

Cette opération n’aligne pas les enregistrements et ne sépare pas les voix captées par un même microphone actif. De grands écarts de gain, la réverbération ou des paroles faibles sous des fuites fortes peuvent entraîner des erreurs. Pour essayer d’autres réglages, annulez d’abord la première application : une nouvelle application cumulerait l’atténuation. Les sélections spectrales et les pistes verrouillées ou gelées ne peuvent pas être traitées.
