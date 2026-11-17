---
title: "Salvare e ripristinare un’istantanea della sessione"
description: "Conserva una versione nominata della disposizione prima di provare una modifica diversa."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","targetLocale":"it"} -->

Conserva una versione nominata della disposizione prima di provare una modifica diversa.

## Prima di iniziare

Apri un progetto Soundscaper scrivibile che contenga l’audio da conservare. L’istantanea appartiene a questo progetto; salva anche un file di progetto portatile come backup separato.

## Passaggi

1. Apri **File > Session snapshots**.
2. Inserisci un **Snapshot name**, ad esempio «Prima dei tagli ai dialoghi», e scegli **Create snapshot**. Chiudi la finestra di dialogo e apporta le modifiche.
3. Per tornare a quella versione, riapri la finestra, selezionala in **Saved snapshots** e scegli **Restore snapshot**.
4. Usa **Rename snapshot** per chiarire il nome di una versione o **Delete snapshot** per rimuovere una versione che non serve più.

## Verificare il risultato

Vengono ripristinati la disposizione precedente e l’audio che conteneva. Chiudi la finestra e riproduci la sezione ripristinata. **Annulla** annulla il ripristino; **Ripristina** lo applica di nuovo.

## Limiti e recupero

Un’istantanea è uno stato nominato del progetto, non un backup esterno. Può conservare audio rimosso dalla disposizione corrente e quindi occupare spazio. Eliminare un’istantanea lascia invariata la disposizione corrente. Consulta i [backup dei progetti](/projects-and-data/storage-backups-and-privacy/).
