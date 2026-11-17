---
title: "Exportar un bucle con sus colas de efectos"
description: "Traslada la cola de una reverberación o un retardo al principio de un archivo de audio repetitivo."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"es"} -->

Traslada la cola de una reverberación o un retardo al principio de un archivo de audio repetitivo.

## Antes de empezar

Prepara un intervalo de bucle exacto con el procesamiento deseado. Usa un formato sin pérdidas, como WAV, para comprobar la unión. Mantén los niveles de reproducción y exportación por debajo del recorte.

## Pasos

1. Selecciona el intervalo que se repetirá y abre **Archivo > Exportar audio**.
2. Elige el intervalo seleccionado y un formato, una frecuencia de muestreo y una disposición de canales adecuados.
3. Activa **Render as loop** en los ajustes de exportación y exporta el archivo.
4. Importa el resultado en un proyecto de prueba y escucha varias repeticiones, sobre todo en el límite.

## Comprobar el resultado

El archivo exportado mantiene la duración del bucle elegido y traslada la cola renderizada a su inicio. Escucha si hay clics o un aumento de nivel y comprueba que la reverberación transiciona suavemente.

## Límites y recuperación

El traslado de la cola no arregla un corte musical inadecuado ni una forma de onda directa discontinua. No es lo mismo que **Incluir colas de efecto hasta 10 segundos**, que alarga una exportación normal. La suma de las colas puede elevar los picos; reduce el nivel o usa el limitador opcional de pico verdadero del Limiter y comprueba el archivo entregado. Los formatos con pérdida pueden añadir relleno o alterar los picos, así que comprueba también el formato de destino real.
