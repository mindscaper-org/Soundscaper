---
title: "Riutilizzare un progetto salvato come audio collegato"
description: "Inserisci un progetto salvato in un’altra disposizione e segui le modifiche successive."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"it"} -->

Inserisci un progetto salvato in un’altra disposizione e segui le modifiche successive.

## Prima di iniziare

Salva il progetto figlio di Soundscaper nella stessa libreria di progetti locale. Completa prima il mix. Renderizza e integra nell’audio l’elaborazione attiva dei plug-in nativi prima di usare il renderer del sottoprogetto in background.

## Passaggi

1. Apri il progetto principale e scegli **File > Subprojects**.
2. Seleziona il progetto figlio in **Project to insert or relink** e scegli **Insert subproject**. Il mix pubblicato appare su una nuova traccia.
3. Seleziona il collegamento in **Linked subprojects** e scegli **Open subproject** per modificare il figlio. Salvalo e torna al progetto principale per ascoltare l’audio aggiornato.
4. Scegli **Pin current audio** per mantenere questa revisione o **Make independent audio** per smettere di seguire il progetto figlio.

## Verificare il risultato

La posizione nel progetto principale rimane invariata quando il figlio si aggiorna. Dopo l’aggiornamento, riproducilo e controlla l’inizio e la fine. Se il mix del figlio è più breve, il silenzio riempie la durata pubblicata originale.

## Limiti e recupero

La durata pubblicata e la disposizione dei canali restano fisse; inserisci un’altra istanza per un intervallo diverso. Un file portatile del progetto principale include l’audio installato, ma non il progetto figlio modificabile. Trasferisci il figlio separatamente e usa **Relink to selected project**. I collegamenti ciclici vengono rifiutati.
