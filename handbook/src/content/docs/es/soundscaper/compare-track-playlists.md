---
title: "Comparar ediciones alternativas de una pista"
description: "Conserva varios arreglos de una pista y cambia de uno a otro."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"8c79a03859a4d9d2082884e1a7ea71d11b90b021b834a5e4699f7a01b7a3b029","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8c79a03859a4d9d2082884e1a7ea71d11b90b021b834a5e4699f7a01b7a3b029","targetLocale":"es"} -->

Conserva varios arreglos de una pista y cambia de uno a otro.

## Antes de empezar

Selecciona la pista de audio que quieras editar en un proyecto de Soundscaper con permisos de escritura. Las listas de reproducción cambian el material de esa pista; usa una [instantánea de sesión](/soundscaper/save-session-snapshots/) para conservar un arreglo completo.

## Pasos

1. Abre **Menú de pistas > Track playlists**.
2. Escribe un **Playlist name** y elige **Duplicate current playlist**. Edita esta copia activa en la línea de tiempo. Si necesitas una versión vacía, elige **Create empty playlist**.
3. Abre el diálogo de nuevo, selecciona **Original** en **Playlists** y elige **Activate playlist** para escuchar la edición anterior.
4. Activa la versión alternativa para compararla. Cuando termines, usa **Rename playlist** o elimina una lista inactiva.

## Comprobar el resultado

Solo aparece la lista activa en esa pista. **Deshacer** revierte el cambio. Espera a que se guarde el proyecto, vuelve a abrirlo y comprueba que las dos versiones con nombre siguen disponibles.

## Límites y recuperación

No se puede eliminar la lista activa. Las versiones inactivas conservan el audio al que hacen referencia y ocupan espacio. Son alternativas de una pista, no capas simultáneas; coloca el material en pistas distintas para oír ambas a la vez.
