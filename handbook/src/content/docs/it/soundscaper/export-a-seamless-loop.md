---
title: "Esportare un loop con le code degli effetti"
description: "Sposta all’inizio di un file audio ripetuto la coda di un riverbero o di un delay."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"it"} -->

Sposta all’inizio di un file audio ripetuto la coda di un riverbero o di un delay.

## Prima di iniziare

Prepara un intervallo esatto per il loop con l’elaborazione desiderata. Per verificare il raccordo, usa un formato senza perdita come WAV. Mantieni i livelli di riproduzione ed esportazione al di sotto del clipping.

## Passaggi

1. Seleziona l’intervallo temporale da ripetere e apri **File > Esporta audio**.
2. Scegli l’intervallo selezionato e un formato, una frequenza di campionamento e una disposizione dei canali adatti.
3. Abilita **Render as loop** nelle impostazioni di esportazione ed esporta il file.
4. Importa il risultato in un progetto di prova e ascolta diverse ripetizioni, soprattutto il confine.

## Verificare il risultato

Il file esportato mantiene la durata del loop scelto e avvolge la coda renderizzata all’inizio. Ascolta se ci sono clic, aumenti di livello o transizioni di riverbero poco fluide.

## Limiti e recupero

L’avvolgimento della coda non corregge un taglio musicale inadatto o una forma d’onda dry discontinua. È diverso da **Includi code degli effetti fino a 10 secondi**, che allunga una normale esportazione. Le code sommate possono aumentare i picchi; riduci il livello oppure usa il true peak limiter facoltativo del Limiter e controlla il file consegnato. I formati lossy possono aggiungere padding o modificare i picchi: verifica anche il formato effettivo di destinazione.
