---
title: "Reducir las filtraciones entre micrófonos de diálogo"
description: "Crea envolventes de ganancia editables que atenúan las filtraciones correlacionadas en micrófonos inactivos."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"es"} -->

Crea envolventes de ganancia editables que atenúan las filtraciones correlacionadas en micrófonos inactivos.

## Antes de empezar

Usa de dos a ocho pistas de diálogo alineadas en el tiempo, idealmente un micrófono por persona y con ganancias de grabación comparables. Selecciona un intervalo de tiempo positivo con audio en todas las pistas elegidas. Desbloquéalas y descongélalas.

## Pasos

1. Selecciona las pistas de micrófono y el pasaje que quieres procesar.
2. Abre **Efecto > Eliminación y reparación de ruido > Automatic microphone-bleed reduction**.
3. Empieza con los ajustes predeterminados y elige **Create gain envelopes**.
4. Reproduce el pasaje, sobre todo las interrupciones y el habla superpuesta. Usa la **Ganancia del clip** para ajustar los puntos generados que atenúen habla deseada.

## Comprobar el resultado

Los puntos de ganancia reducen la filtración y mantienen disponibles las fuentes originales y la posición de los clips. Comprueba las entradas de cada hablante y los límites de la selección. **Deshacer** elimina la operación y **Rehacer** la vuelve a aplicar.

## Límites y recuperación

La función no alinea grabaciones ni separa voces dentro de un micrófono activo. Las grandes diferencias de ganancia, la reverberación y el habla baja bajo una filtración fuerte pueden causar errores. Si quieres probar otros ajustes, deshaz primero la aplicación inicial; volver a aplicarla acumula la atenuación. No se pueden procesar selecciones espectrales ni pistas bloqueadas o congeladas.
