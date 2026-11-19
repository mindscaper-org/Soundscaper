---
title: "Convertir notas grabadas en MIDI editable"
description: "Analiza una grabación musical con Basic Pitch y conserva notas editables junto al audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"es"} -->

Analiza una grabación musical con Basic Pitch y conserva notas editables junto al audio.

## Antes de empezar

Usa Soundscaper de escritorio con el modelo Basic Pitch publicado y el runtime compatible instalados. Empieza con una selección musical breve de tonos claros. Conserva el audio como referencia de escucha.

## Pasos

1. Selecciona el audio musical y abre **Herramientas > Procesamiento local avanzado**.
2. Configura **Operación** como **Audio to MIDI (Basic Pitch)**. Confirma cualquier consentimiento necesario para el procesamiento local y elige **Analizar**.
3. Elige **Revisar resultado**, inspecciona las notas detectadas y selecciona **Aceptar propuesta** cuando quieras.
4. Abre **Ventana > Piano roll (beta)**, selecciona el material MIDI nuevo y corrige las notas, la temporización y la duración.

## Comprobar el resultado

Aparece una pista MIDI nueva junto al audio original. Elige un instrumento y escúchalo con la grabación. **Deshacer** elimina la propuesta aceptada sin borrar el audio de origen.

## Límites y recuperación

Las notas detectadas son estimaciones, sobre todo en mezclas densas o grabaciones ruidosas. MIDI captura notas, no el timbre original. Usa [instrumentos MIDI](/soundscaper/play-midi-instruments/) para reproducirlas y **Archivo > Exportar otros > Export MIDI (beta)** para compartir las notas. Quienes las reciban aún necesitan un instrumento que reproduzca el sonido deseado.
