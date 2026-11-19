---
title: "Ridurre il rumore durante la riproduzione"
description: "Aggiungi un effetto di riduzione del rumore con IA in tempo reale a una traccia di dialogo."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"it"} -->

Aggiungi un effetto di riduzione del rumore con IA in tempo reale a una traccia di dialogo.

## Prima di iniziare

Usa Soundscaper desktop. Apri **Strumenti > Gestione modelli** e installa il modello di denoising in tempo reale corrispondente e il runtime offerti dalla tua build. L’installazione del modello è un download esplicito; il browser da solo non può eseguire questo effetto nativo.

## Passaggi

1. Seleziona la traccia di dialogo rumorosa e apri il suo rack di effetti in tempo reale.
2. Scegli **Aggiungi effetto** e seleziona **AI denoising (DPDFNet2)**.
3. Avvia la riproduzione e confrontala con l’effetto bypassato tramite il relativo pulsante di alimentazione.
4. Regola il mix intorno alla traccia ripulita e ascolta l’esportazione prima della consegna. Salva il progetto per conservare il rack.

## Verificare il risultato

Il rumore dovrebbe diminuire mentre il parlato rimane intelligibile. Controlla consonanti deboli, respiri e l’inizio della riproduzione. Se senti pumping o parole mancanti, bypassa l’effetto e confronta l’originale.

## Limiti e recupero

È un denoising del parlato, non un effetto generale di restauro musicale. Per riprodurre il progetto su un altro computer servono il modello compatibile e il runtime nativo. Se l’effetto non è disponibile, verifica l’installazione e il supporto desktop; per un risultato renderizzato e revisionato usa il [restauro vocale offline](/soundscaper/restore-damaged-speech/). Il download di un modello non garantisce che ogni registrazione migliori.
