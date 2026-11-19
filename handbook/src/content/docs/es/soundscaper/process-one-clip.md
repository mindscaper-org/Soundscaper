---
title: "Aplicar efectos en tiempo real a un clip"
description: "Asigna su propio rack de efectos a un clip de audio sin procesar todos los clips de la pista."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"es"} -->

Asigna su propio rack de efectos a un clip de audio sin procesar todos los clips de la pista.

## Antes de empezar

Selecciona un clip de audio en Soundscaper. Sus efectos forman parte del procesamiento del clip y alimentan los efectos de la pista; el procesamiento de pista y master aún puede cambiar lo que escuchas.

## Pasos

1. Abre **Ventana > Propiedades del clip** y despliega **Efectos**. Este es el rack de efectos del clip.
2. Elige **Añadir efecto**, selecciona un efecto y ajusta sus parámetros. Reproduce el clip para escucharlo.
3. Usa el botón de encendido del efecto para comparar el sonido procesado con el efecto omitido. Cambia el orden o elimina efectos del rack según necesites.
4. Guarda el proyecto y escucha el clip junto a los contiguos. Usa **Deshacer** si el cambio no ayuda.

## Comprobar el resultado

El clip seleccionado tiene su propio procesamiento y los demás conservan sus ajustes. Escucha más allá del final del clip por si hay una cola de reverberación o retardo; si el resultado conjunto es demasiado intenso, comprueba el rack de la pista.

## Límites y recuperación

La cola de un efecto puede durar más que el audio de origen del clip; antes de la entrega, comprueba las opciones de cola de exportación. Para un detector Auto Duck, elige otra pista adecuada; no se permiten bucles de realimentación. Abre **Más opciones > Auto-idle** en el encabezado del efecto para controlar el reposo durante el silencio. Desactívalo en los complementos sensibles a la temporización. Consulta [procesamiento local](/help/local-processing/) para ver los ajustes relacionados.
