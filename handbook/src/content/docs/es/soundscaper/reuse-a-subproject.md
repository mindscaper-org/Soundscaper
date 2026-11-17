---
title: "Reutilizar un proyecto guardado como audio vinculado"
description: "Inserta un proyecto guardado en otro arreglo y sigue sus cambios posteriores."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"es"} -->

Inserta un proyecto guardado en otro arreglo y sigue sus cambios posteriores.

## Antes de empezar

Guarda el proyecto hijo de Soundscaper en la misma biblioteca local de proyectos. Termina primero la mezcla. Renderiza y confirma en el audio el procesamiento activo de complementos nativos antes de usar el renderizador de subproyectos en segundo plano.

## Pasos

1. Abre el proyecto principal y elige **Archivo > Subprojects**.
2. Selecciona el proyecto hijo en **Project to insert or relink** y elige **Insert subproject**. Su mezcla publicada aparece en una pista nueva.
3. Selecciona el vínculo en **Linked subprojects** y elige **Open subproject** para editar el hijo. Guárdalo y vuelve al proyecto principal para escuchar el audio actualizado.
4. Elige **Pin current audio** para conservar esta revisión o **Make independent audio** para dejar de seguir el proyecto hijo.

## Comprobar el resultado

La ubicación del proyecto principal se mantiene cuando se actualiza el hijo. Reprodúcelo después de actualizarlo y comprueba el principio y el final. Si la mezcla del hijo es más corta, se rellena con silencio dentro del intervalo publicado original.

## Límites y recuperación

La duración publicada y la disposición de canales son fijas; inserta otra instancia para usar un intervalo distinto. Un archivo portátil del proyecto principal incluye el audio instalado, pero no el proyecto hijo editable. Transfiere el hijo aparte y usa **Relink to selected project**. No se permiten vínculos cíclicos.
