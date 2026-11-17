---
title: "Guardar y restaurar una instantánea de sesión"
description: "Conserva una versión con nombre del arreglo antes de probar otra edición."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","targetLocale":"es"} -->

Conserva una versión con nombre del arreglo antes de probar otra edición.

## Antes de empezar

Abre un proyecto de Soundscaper con permisos de escritura y el audio que quieras conservar. La instantánea pertenece a ese proyecto; guarda también un archivo de proyecto portátil como copia de seguridad independiente.

## Pasos

1. Abre **Archivo > Session snapshots**.
2. Escribe un **Snapshot name**, por ejemplo, «Antes de los cortes de diálogo», y elige **Create snapshot**. Cierra el diálogo y haz tus cambios.
3. Para volver a esa versión, abre de nuevo el diálogo, selecciónala en **Saved snapshots** y elige **Restore snapshot**.
4. Usa **Rename snapshot** para aclarar una versión o **Delete snapshot** para borrar una que ya no necesites.

## Comprobar el resultado

Se restauran el arreglo anterior y el audio que conservaba. Cierra el diálogo y reproduce la sección restaurada. **Deshacer** revierte la restauración; **Rehacer** la vuelve a aplicar.

## Límites y recuperación

Una instantánea es un estado con nombre del proyecto, no una copia de seguridad externa. Puede conservar audio que hayas quitado del arreglo actual y, por tanto, ocupa espacio. Al borrar una instantánea, el arreglo actual permanece intacto. Consulta [copias de seguridad de proyectos](/projects-and-data/storage-backups-and-privacy/).
