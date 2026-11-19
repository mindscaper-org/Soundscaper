---
title: "Renderizar un programa ADM para altavoces"
description: "Exporta Beds y objetos ADM creados por ti como audio normal para altavoces con EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"es"} -->

Exporta Beds y objetos ADM creados por ti como audio normal para altavoces con EBU EAR.

## Antes de empezar

Crea un programa ADM en la pestaña ADM del editor de metadatos, con asignaciones de beds y objetos posicionados. Identifica la disposición de altavoces de destino y elige un contenedor y un códec que admitan su número de canales.

## Pasos

1. Abre **Archivo > Exportar audio**.
2. En **Renderizado > EBU EAR speaker rendering**, elige una disposición: estéreo, 5.1, 5.1.2, 5.1.4, 7.1 o 7.1.4.
3. Comprueba el formato de salida, el número de canales y los ajustes de nivel; después, exporta.
4. Lee el informe de entrega y escucha el archivo exportado en la disposición de altavoces correspondiente.

## Comprobar el resultado

La salida contiene PCM renderizado para altavoces en el orden de canales declarado. Esta opción de exportación no cambia la monitorización del proyecto ni la creación ADM original. Consulta el informe para saber qué renderizador y disposición se usaron.

## Límites y recuperación

El renderizado EAR para altavoces no se puede combinar con el renderizado para auriculares. Las salidas divididas y el passthrough BW64/ADM no admiten esta opción. Los canales renderizados no conservan los metadatos ADM originales de bed/object; usa BW64 sin renderizar para ese intercambio. Los objetos móviles o difusos, HOA, la gestión de graves y el renderizado Dolby certificado no forman parte de esta función. El medidor de sonoridad normal admite como máximo ocho canales de salida.
