---
title: "Riprodurre MIDI con uno strumento"
description: "Scegli un sintetizzatore per le note MIDI e conserva l’esecuzione modificabile."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"it"} -->

Scegli un sintetizzatore per le note MIDI e conserva l’esecuzione modificabile.

## Prima di iniziare

Apri o importa MIDI oppure crea una nuova traccia in Soundscaper. Le opzioni di riproduzione integrate variano in base agli strumenti nativi facoltativi. Gli strumenti come plug-in nativi richiedono l’app desktop e il plug-in corrispondente abilitato.

## Passaggi

1. Se ti serve una traccia, scegli **Tracce > Aggiungi nuova traccia > MIDI track (beta)**.
2. Apri **Finestra > Piano roll (beta)**. Aggiungi note o seleziona materiale MIDI esistente.
3. Scegli **Instrument**. Per uno strumento nativo, apri **Instrument settings** per modificarne il suono e salvare una preimpostazione.
4. Avvia la riproduzione, controlla le note e il sustain, quindi salva e riapri il progetto.

## Verificare il risultato

Dovresti sentire lo strumento selezionato mentre le note restano modificabili nel piano roll. Le impostazioni e le preimpostazioni dello strumento dovrebbero tornare alla riapertura se il plug-in richiesto è installato.

## Limiti e recupero

Gli strumenti nativi sono disponibili sulle tracce MIDI, non sulle normali tracce audio. Una preimpostazione salvata non include il binario del plug-in né le relative librerie esterne. Gli strumenti inclusi sono abilitati per impostazione predefinita nei pacchetti desktop supportati; altri potrebbero richiedere il [Gestore plug-in](/soundscaper/use-desktop-plugins/). Verifica riproduzione ed esportazione sul computer di destinazione prima di fare affidamento sullo stesso timbro.
