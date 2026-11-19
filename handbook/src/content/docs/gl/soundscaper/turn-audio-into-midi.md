---
title: "Converter notas gravadas en MIDI editable"
description: "Analiza unha gravación musical con Basic Pitch e mantén notas editables xunto ao audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"gl"} -->

Analiza unha gravación musical con Basic Pitch e mantén notas editables xunto ao audio.

## Antes de comezar

Usa Soundscaper para escritorio co modelo Basic Pitch publicado e o runtime correspondente instalados. Comeza cunha selección musical breve e de tons claros. Conserva o audio como referencia para escoitalo.

## Pasos

1. Selecciona o audio musical e abre **Ferramentas > Procesamento local avanzado**.
2. Configura **Operación** como **Audio to MIDI (Basic Pitch)**. Confirma calquera consentimento necesario para o procesamento local e escolle **Analizar**.
3. Escolle **Revisar resultado**, inspecciona as notas detectadas e selecciona **Aceptar proposta** cando esteas listo.
4. Abre **Xanela > Piano roll (beta)**, selecciona o novo material MIDI e corrixe as alturas, a temporización e as duracións das notas.

## Comprobar o resultado

Aparece unha pista MIDI nova xunto ao audio orixinal. Escolle un instrumento e escoita como soa coa gravación. **Desfacer** elimina a proposta aceptada sen borrar o audio de orixe.

## Límites e recuperación

As notas detectadas son aproximacións, especialmente en mesturas densas ou gravacións ruidosas. MIDI recolle notas, non o timbre orixinal. Usa [instrumentos MIDI](/soundscaper/play-midi-instruments/) para a reprodución e **Ficheiro > Outras exportacións > Export MIDI (beta)** para compartir as notas. As persoas que as reciban precisan un instrumento que reproduza o son previsto.
