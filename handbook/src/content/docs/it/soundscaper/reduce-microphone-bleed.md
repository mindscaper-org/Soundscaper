---
title: "Ridurre il rientro tra microfoni per dialoghi"
description: "Crea inviluppi di gain modificabili che abbassano il rientro correlato nei microfoni inattivi."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"it"} -->

Crea inviluppi di gain modificabili che abbassano il rientro correlato nei microfoni inattivi.

## Prima di iniziare

Usa da due a otto tracce di dialogo allineate nel tempo, idealmente un microfono per persona con gain di registrazione comparabili. Seleziona un intervallo temporale positivo con audio su ogni traccia scelta. Sblocca e scongela le tracce.

## Passaggi

1. Seleziona le tracce dei microfoni e il passaggio da elaborare.
2. Apri **Effetto > Rimozione e riparazione del rumore > Automatic microphone-bleed reduction**.
3. Inizia con le impostazioni predefinite e scegli **Create gain envelopes**.
4. Riproduci il passaggio, soprattutto interruzioni e voci sovrapposte. Usa il **Guadagno della clip** per regolare i punti generati che abbassano il parlato desiderato.

## Verificare il risultato

I punti di gain riducono il rientro lasciando disponibili le sorgenti originali e le posizioni delle clip. Controlla gli ingressi di ogni persona e i limiti della selezione. **Annulla** rimuove l’operazione, **Ripristina** la ripristina.

## Limiti e recupero

La funzione non allinea registrazioni e non separa le voci all’interno di un microfono attivo. Forti differenze di gain, riverbero e parlato basso sotto un rientro intenso possono causare errori. Se vuoi provare impostazioni diverse, annulla prima la prima applicazione: ripeterla somma l’attenuazione. Le selezioni spettrali e le tracce bloccate o congelate non possono essere elaborate.
