---
title: "Applicare effetti in tempo reale a una clip"
description: "Assegna a una clip audio un rack di effetti dedicato senza elaborare tutte le clip della traccia."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"it"} -->

Assegna a una clip audio un rack di effetti dedicato senza elaborare tutte le clip della traccia.

## Prima di iniziare

Seleziona una clip audio in Soundscaper. Gli effetti della clip fanno parte della sua elaborazione e alimentano gli effetti della traccia; l’elaborazione della traccia e del master può comunque cambiare ciò che senti.

## Passaggi

1. Apri **Finestra > Proprietà della clip** ed espandi **Effetti**. È il rack degli effetti della clip.
2. Scegli **Aggiungi effetto**, seleziona un effetto e regolane le impostazioni. Riproduci la clip per ascoltarla.
3. Usa il pulsante di alimentazione dell’effetto per confrontare il suono con l’effetto bypassato e attivo. Riordina o rimuovi gli effetti dal rack quando serve.
4. Salva il progetto e ascolta la clip insieme alle vicine. Usa **Annulla** se la modifica non è utile.

## Verificare il risultato

La clip selezionata ha un’elaborazione propria mentre le altre mantengono le rispettive impostazioni. Ascolta oltre la fine per individuare code di riverbero o delay e controlla il rack della traccia se l’effetto complessivo è troppo forte.

## Limiti e recupero

La coda di un effetto può durare più dell’audio sorgente della clip; prima della consegna controlla le opzioni di coda in esportazione. Per un rilevatore Auto Duck, scegli un’altra traccia adatta; i loop di feedback vengono rifiutati. Apri **Altre opzioni > Auto-idle** nell’intestazione dell’effetto per controllare la modalità inattiva durante il silenzio. Disattivala per i plug-in sensibili alla temporizzazione. Consulta [l’elaborazione locale](/help/local-processing/) per le impostazioni correlate.
