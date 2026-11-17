---
title: "Exportar un bucle coas colas dos efectos"
description: "Leva a cola dunha reverberación ou dun retardo ao comezo dun ficheiro de audio repetitivo."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"gl"} -->

Leva a cola dunha reverberación ou dun retardo ao comezo dun ficheiro de audio repetitivo.

## Antes de comezar

Prepara un intervalo exacto para o bucle co procesamento desexado. Usa un formato sen perdas, como WAV, para comprobar a unión. Mantén os niveis de reprodución e exportación por baixo do recorte.

## Pasos

1. Selecciona o intervalo que se repetirá e abre **Ficheiro > Exportar son**.
2. Escolle o intervalo seleccionado, un formato adecuado, a frecuencia de mostraxe e a disposición de canles.
3. Activa **Render as loop** nos axustes de exportación e exporta o ficheiro.
4. Importa o resultado nun proxecto de proba e escoita varias repeticións, sobre todo no límite.

## Comprobar o resultado

O ficheiro exportado mantén a duración do bucle escollido e traslada a cola renderizada ao seu comezo. Escoita se hai clics ou subas de nivel e se a reverberación transiciona con suavidade.

## Límites e recuperación

Trasladar a cola non corrixe un corte musical inadecuado nin unha forma de onda seca descontinua. É distinto de **Incluír colas de efecto de ata 10 segundos**, que prolonga unha exportación normal. As colas sumadas poden elevar os picos; reduce o nivel ou usa a limitación opcional do pico verdadeiro do Limiter e comproba o ficheiro entregado. Os formatos con perdas poden engadir recheo ou cambiar os picos, así que revisa tamén o formato de destino real.
