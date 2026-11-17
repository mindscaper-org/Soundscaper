---
title: "Restaurar el habla dañada con un modelo local"
description: "Revisa el resultado opcional de restauración de voz antes de aplicarlo a la grabación."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","targetLocale":"es"} -->

Revisa el resultado opcional de restauración de voz antes de aplicarlo a la grabación.

## Antes de empezar

Usa la aplicación de escritorio y selecciona el habla que quieras reparar. Conserva el original o una instantánea. Los modelos que aparecen para esta tarea dependen del catálogo publicado y del runtime instalado; puede que tu compilación no ofrezca VoiceFixer.

## Pasos

1. Abre **Efecto > Eliminación y reparación de ruido > Mejorar diálogo**.
2. Elige un **Modelo** compatible. Cuando esté disponible, **VoiceFixer** está pensado para reparar el recorte y restaurar el habla; si hace falta, instálalo expresamente desde los controles de modelos.
3. Ejecuta la tarea, elige **Revisar resultado** y escucha el audio propuesto junto al original.
4. Acepta la propuesta solo si el habla mejora. Antes de aplicarla, comprueba la ubicación seleccionada y guarda el proyecto.

## Comprobar el resultado

Escucha los picos reparados y una voz más clara, pero también las vocales, respiraciones y el sonido de fondo modificados. El resultado aceptado es una edición de audio que puedes escuchar y deshacer; rechazar o cerrar la revisión no lo aplica.

## Límites y recuperación

VoiceFixer vuelve a sintetizar el habla y puede cambiar el timbre y el contenido de fondo. No es una herramienta general para eliminar recorte musical. Si no aparece en el selector, usa un mejorador disponible o la [guía normal para reparar picos recortados](/guides/cleaning-up/restore-clipped-peaks/); estos pasos no permiten activar un modelo no ofrecido.
