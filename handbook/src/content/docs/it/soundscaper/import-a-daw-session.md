---
title: "Importare una sessione audio da un altro editor"
description: "Importa modifiche audio supportate, ricollega i relativi file multimediali e verifica i limiti di conversione."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"it"} -->

Importa modifiche audio supportate, ricollega i relativi file multimediali e verifica i limiti di conversione.

## Prima di iniziare

Copia la sessione e l’audio in una cartella accessibile. Sono supportate sessioni audio native REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, sessioni SoundCraft e Audition `.sesx` o il vecchio formato `.ses`. Conserva il progetto originale.

## Passaggi

1. Scegli **File > Apri** o **File > Importa**, oppure trascina la sessione nell’area di lavoro.
2. Nel browser, seleziona insieme alla sessione l’audio associato. Desktop: concedi l’accesso alla cartella dei file multimediali quando richiesto.
3. Apri **File > Rapporto di consegna**. Leggi omissioni e conversioni, poi ricollega i file non in linea quando serve.
4. Ascolta modifiche e dissolvenze rappresentative, controlla ordine e tempi delle tracce e salva un nuovo progetto Scape.

## Verificare il risultato

I tagli importati dovrebbero corrispondere all’audio sorgente accessibile. Confronta il risultato con un mix di riferimento dell’editor originale, soprattutto se elaborazione, routing o automazione sono importanti.

## Limiti e recupero

L’importazione nativa converte le modifiche audio ma non garantisce mix identici. I dettagli supportati variano in base al formato; i plug-in della sessione sorgente non vengono eseguiti. REAPER usa le take audio attive e omette la creazione di take alternative, MIDI, routing e plug-in. Per scambiare file con un’altra DAW, usa formati supportati come AES31 ADL o DAWproject invece di aspettarti la scrittura di una sessione nativa.
