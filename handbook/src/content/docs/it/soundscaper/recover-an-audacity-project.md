---
title: "Recuperare l’audio da un progetto Audacity danneggiato"
description: "Valuta un progetto danneggiato e salva il lavoro recuperato in una copia separata."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"it"} -->

Valuta un progetto danneggiato e salva il lavoro recuperato in una copia separata.

## Prima di iniziare

Per prima cosa, crea una copia del progetto Audacity danneggiato. Mantieni insieme gli eventuali file associati. Il recupero può gestire i file `.aup3` supportati e i progetti Audacity non salvati, ma non può ricreare campioni che non esistono più.

## Passaggi

1. Apri **File > Gestione progetti > Recupera progetto Audacity**.
2. Seleziona il progetto danneggiato. Leggi la **Recovery assessment** prima di importare o salvare qualsiasi cosa.
3. Esamina gli **Missing audio ranges**, incluse le pagine aggiuntive con le posizioni interessate.
4. Se disponibile, scegli **Save repaired Audacity copy**. Altrimenti apri il risultato recuperato, controlla il rapporto di compatibilità e salva il lavoro con un nuovo nome.

## Verificare il risultato

Riproduci le sezioni recuperate e confronta interruzioni o silenzi con il rapporto. Conferma che la nuova copia si apra prima di farvi affidamento. Conserva il file originale danneggiato per un altro tentativo di recupero.

## Limiti e recupero

Il recupero può salvare prefissi audio validi e sostituire i campioni mancanti con il silenzio. Un database riparato non implica che tutto l’audio sia sopravvissuto o che tutte le funzioni di modifica native siano state trasferite. Leggi le omissioni indicate e non sovrascrivere mai l’unico originale durante la diagnosi. Per progetti integri, usa la [guida all’importazione di Audacity](/guides/projects/open-an-audacity-project/).
