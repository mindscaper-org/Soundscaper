---
title: "Usare plug-in audio desktop"
description: "Trova, abilita e ascolta effetti e strumenti nativi in Soundscaper desktop."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","targetLocale":"it"} -->

Trova, abilita e ascolta effetti e strumenti nativi in Soundscaper desktop.

## Prima di iniziare

Installa una build del plug-in compatibile con il sistema operativo e il formato host supportato. I plug-in desktop inclusi sono disponibili per impostazione predefinita nei pacchetti supportati; i plug-in aggiuntivi richiedono comunque l’individuazione e le autorizzazioni necessarie.

## Passaggi

1. Apri **Effetto > Gestione plugin**. Cerca nell’elenco e usa **Scansione e impostazioni** per le opzioni di rilevamento.
2. Seleziona il plug-in e controlla versione, autorizzazioni e controlli di recupero. Abilitalo se appropriato.
3. Aggiungi un effetto da **Effetto > Effetti plugin audio** o da un rack in tempo reale. Seleziona strumenti nativi dai controlli dello strumento della traccia MIDI.
4. Ascolta la riproduzione, salva una preimpostazione se utile e salva il progetto.

## Verificare il risultato

Il plug-in desiderato deve elaborare il suono e ricaricare le impostazioni salvate quando è disponibile lo stesso binario compatibile. Bypassalo per confrontare e controlla l’esportazione prima della consegna.

## Limiti e recupero

I pacchetti Windows supportano i percorsi bridge VST2 mantenuti, inclusi i plug-in a 32 bit supportati. Su Linux è possibile usare Windows VST3 tramite una configurazione yabridge/Wine installata e configurata; questo non installa né concede licenze per plug-in di terze parti. Le preimpostazioni non includono binari. Se un plug-in non funziona, usa i controlli di recupero del Gestore plug-in e prova una versione compatibile prima di riprendere il lavoro.
