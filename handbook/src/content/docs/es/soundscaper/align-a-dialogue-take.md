---
title: "Alinear una toma de diálogo de reemplazo"
description: "Ajusta una segunda interpretación de las mismas palabras a un clip de referencia."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","targetLocale":"es"} -->

Ajusta una segunda interpretación de las mismas palabras a un clip de referencia.

## Antes de empezar

Prepara dos clips de audio mono o estéreo desbloqueados, de entre 0,25 y 30 segundos. Deben contener las mismas palabras y una interpretación razonablemente parecida. Renderiza o desvincula primero el material vinculado a vídeo o anclado al ritmo.

## Pasos

1. Abre **Editar > Clips de audio > Align dialogue**.
2. Selecciona explícitamente la referencia y la toma de reemplazo y, a continuación, establece la intensidad de alineación.
3. Elige **Analyze and align**. Compara **Play reference**, **Play replacement** y **Play aligned**. Presta atención a las consonantes y las respiraciones.
4. Elige **Create aligned copy** solo cuando el resultado suene bien.

## Comprobar el resultado

Una pista nueva contiene una copia alineada al inicio y con la duración de la referencia. Los originales siguen disponibles. **Deshacer** elimina la copia creada en un paso. Guarda y vuelve a abrir el proyecto para seguir usando el resultado renderizado sin repetir el análisis.

## Límites y recuperación

La toma de reemplazo debe durar entre la mitad y el doble que la referencia. La alineación es acústica: no analiza los labios ni verifica una transcripción. Las palabras distintas, el ruido de fondo o las voces superpuestas pueden impedirla. Si el análisis no encuentra coincidencia, usa frases más breves que coincidan o edita manualmente. Cambiar las entradas o la intensidad requiere otro análisis.
