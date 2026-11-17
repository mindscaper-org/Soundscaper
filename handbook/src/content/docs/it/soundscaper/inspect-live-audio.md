---
title: "Analizzare il suono durante la riproduzione"
description: "Usa il pannello Analisi per spettro e loudness in tempo reale, controlli stereo e un rapporto audio ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"it"} -->

Usa il pannello Analisi per spettro e loudness in tempo reale, controlli stereo e un rapporto audio ACX.

## Prima di iniziare

Apri un progetto con audio. Decidi se vuoi esaminare la riproduzione o un intervallo selezionato: la selezione temporale può passare il grafico dello spettro all’analisi della selezione.

## Passaggi

1. Apri **Analizza > Analisi**. Espandi le sezioni necessarie, come **Spectrum**, spettrogramma, loudness o correlazione.
2. Deseleziona l’intervallo temporale e avvia la riproduzione per una visualizzazione in tempo reale. Confronta le sovrapposizioni delle tracce nello spettro per individuare bande di frequenza in competizione.
3. Ferma la riproduzione e seleziona un passaggio per esaminarne lo spettro senza riprodurlo.
4. Per controllare gli audiolibri, espandi **ACX compliance** e scegli **Check audio**. Leggi la tabella dei risultati e usa **Esporta** per ottenere il rapporto JSON.

## Verificare il risultato

Le visualizzazioni in tempo reale rispondono alla riproduzione. Il rapporto ACX indica l’esito positivo o negativo dei controlli audio, anziché mostrare solo un indicatore. Correggi i livelli o le impostazioni del formato non conformi e ripeti il controllo.

## Limiti e recupero

Lo spettro mostra l’energia, non se il mix suona bene. Correlazione e loudness richiedono contesto e ascolto. I controlli audio ACX non garantiscono l’accettazione da parte di un servizio di pubblicazione e non verificano tutti i requisiti editoriali. Comprimere la sezione ACX cancella il controllo visualizzato: eseguilo di nuovo quando serve. Chiudi le sezioni dell’analizzatore non necessarie per ridurre l’attività di visualizzazione.
