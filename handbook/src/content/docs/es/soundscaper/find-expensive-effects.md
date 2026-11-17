---
title: "Encontrar efectos que consumen CPU durante la reproducción"
description: "Compara el coste de los efectos en tiempo real antes de decidir qué procesamiento simplificar."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"es"} -->

Compara el coste de los efectos en tiempo real antes de decidir qué procesamiento simplificar.

## Antes de empezar

Usa un proyecto con efectos en tiempo real y un pasaje representativo y exigente. Las mediciones describen este dispositivo y esta carga de trabajo; no son una clasificación universal de complementos.

## Pasos

1. Abre **Ayuda > CPU profiling**.
2. Después de abrir el panel, inicia o reinicia la reproducción para medir cada efecto en tiempo real.
3. Observa varias actualizaciones. Compara las filas de los efectos con la fila básica del editor, omite un efecto costoso y reproduce el mismo pasaje.
4. Cuando termines, cierra el panel y restaura el procesamiento que quieras conservar.

## Comprobar el resultado

El uso de CPU puede superar la capacidad de un solo núcleo: el 100 % representa un núcleo de CPU totalmente ocupado. Compara los porcentajes de CPU y del tiempo de procesamiento transcurrido. Un guion indica que no hay una medición disponible, no que el efecto tenga un coste nulo.

## Límites y recuperación

El tiempo de procesamiento transcurrido incluye retrasos de planificación. Se excluyen el uso de GPU y los procesos auxiliares externos; el perfilado también añade sobrecarga. Los efectos omitidos se identifican por separado. Abre **Más opciones > Auto-idle** en el encabezado de un efecto para que un procesador adecuado pueda entrar en reposo durante el silencio. Desactívalo en los efectos que necesitan una temporización continua. Consulta [procesamiento local](/help/local-processing/) para ver los ajustes relacionados. Reproduce siempre el mismo pasaje al comparar cambios.
