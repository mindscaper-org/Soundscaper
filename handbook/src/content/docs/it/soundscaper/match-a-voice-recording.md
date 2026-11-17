---
title: "Abbinare il tono di una registrazione vocale"
description: "Apprendi un riferimento timbrico e usa Match EQ per avvicinarvi un’altra registrazione."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"it"} -->

Apprendi un riferimento timbrico e usa Match EQ per avvicinarvi un’altra registrazione.

## Prima di iniziare

Scegli un riferimento udibile a banda piena di almeno un quarto di secondo, preferibilmente la stessa persona registrata bene. Prepara la registrazione di destinazione. L’elaborazione è locale sia nel browser che nell’app desktop.

## Passaggi

1. Seleziona il riferimento e apri **Effetto > EQ e filtri > Match EQ**. Scegli **Learn reference from selection**.
2. Salva il riferimento appreso come preimpostazione se vuoi riutilizzare il profilo vocale. Chiudi la finestra di dialogo.
3. Seleziona il target, riapri Match EQ, richiama il riferimento se necessario e scegli **Analyze target**.
4. Con **Originale**, confronta **Matched (level compensated)** e **Anteprima**. Regola la correzione, poi scegli **Applica alla selezione** oppure **Edit as Filter Curve EQ** per intervenire sulla curva.

## Verificare il risultato

Ascolta a un volume simile per capire se il bilanciamento timbrico è più vicino. L’audio elaborato mantiene durata e numero di canali. **Annulla** annulla l’applicazione.

## Limiti e recupero

Match EQ non può ripristinare la banda mancante né abbinare interpretazione, dinamica, riverbero della stanza o identità della voce. L’acquisizione del riferimento include gli effetti della traccia prima di bus e master; il target viene analizzato prima del rack della sua traccia. Renderizza prima il riferimento se il suono desiderato dipende dall’elaborazione a valle.
