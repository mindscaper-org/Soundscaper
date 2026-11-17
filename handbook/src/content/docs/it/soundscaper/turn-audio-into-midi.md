---
title: "Trasformare note registrate in MIDI modificabile"
description: "Analizza una registrazione musicale con Basic Pitch e conserva note modificabili accanto all’audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"it"} -->

Analizza una registrazione musicale con Basic Pitch e conserva note modificabili accanto all’audio.

## Prima di iniziare

Usa Soundscaper desktop con il modello Basic Pitch pubblicato e il runtime corrispondente installati. Inizia con una selezione musicale breve e con altezze ben definite. Conserva l’audio come riferimento d’ascolto.

## Passaggi

1. Seleziona l’audio musicale e apri **Strumenti > Elaborazione locale avanzata**.
2. Imposta **Operazione** su **Audio to MIDI (Basic Pitch)**. Conferma l’eventuale consenso richiesto per l’elaborazione locale e scegli **Analizza**.
3. Scegli **Rivedi il risultato**, controlla le note rilevate e seleziona **Accetta la proposta** quando vuoi.
4. Apri **Finestra > Piano roll (beta)**, seleziona il nuovo materiale MIDI e correggi altezze, tempi e durate delle note.

## Verificare il risultato

Accanto all’audio originale appare una nuova traccia MIDI. Scegli uno strumento e ascoltalo insieme alla registrazione. **Annulla** rimuove la proposta accettata senza eliminare l’audio sorgente.

## Limiti e recupero

Le note rilevate sono stime, soprattutto in mix densi o registrazioni rumorose. MIDI cattura le note, non il timbro originale. Usa gli [strumenti MIDI](/soundscaper/play-midi-instruments/) per la riproduzione e **File > Altri formati di esportazione > Export MIDI (beta)** per condividere le note. I destinatari hanno comunque bisogno di uno strumento capace di riprodurre il suono desiderato.
