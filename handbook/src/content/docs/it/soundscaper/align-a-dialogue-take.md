---
title: "Allineare una nuova ripresa di dialogo"
description: "Adatta una seconda interpretazione delle stesse parole a una clip di riferimento."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","targetLocale":"it"} -->

Adatta una seconda interpretazione delle stesse parole a una clip di riferimento.

## Prima di iniziare

Prepara due clip audio mono o stereo sbloccate, lunghe da 0,25 a 30 secondi. Devono contenere le stesse parole e un’interpretazione abbastanza simile. Prima renderizza o scollega il materiale collegato al video o ancorato al ritmo.

## Passaggi

1. Apri **Modifica > Clip audio > Align dialogue**.
2. Scegli esplicitamente il riferimento e la ripresa sostitutiva, poi imposta l’intensità dell’allineamento.
3. Scegli **Analyze and align**. Confronta **Play reference**, **Play replacement** e **Play aligned**. Ascolta con attenzione consonanti e respiri.
4. Scegli **Create aligned copy** solo se il risultato suona corretto.

## Verificare il risultato

Una nuova traccia contiene una copia allineata all’inizio e alla durata del riferimento. Gli originali restano disponibili. **Annulla** rimuove la copia creata con un solo passaggio. Salva e riapri il progetto per continuare a usare il risultato renderizzato senza ripetere l’analisi.

## Limiti e recupero

La sostituzione deve durare tra la metà e il doppio del riferimento. L’allineamento è acustico e non esamina le labbra né verifica una trascrizione. Parole diverse, rumore di fondo o voci sovrapposte possono comprometterlo. Se l’analisi rifiuta la corrispondenza, usa frasi più brevi e corrispondenti oppure modifica manualmente. Cambiare ingressi o intensità richiede una nuova analisi.
