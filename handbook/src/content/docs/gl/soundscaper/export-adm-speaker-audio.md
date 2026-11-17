---
title: "Renderizar un programa ADM para altofalantes"
description: "Exporta camas e obxectos ADM propios como audio normal para altofalantes usando EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"gl"} -->

Exporta camas e obxectos ADM propios como audio normal para altofalantes usando EBU EAR.

## Antes de comezar

Crea un programa ADM na pestana ADM do editor de metadatos, coas asignacións das camas e os obxectos posicionados. Coñece a disposición de altofalantes da entrega e escolle un contedor e un códec compatibles coa súa cantidade de canles.

## Pasos

1. Abre **Ficheiro > Exportar son**.
2. En **Renderizado > EBU EAR speaker rendering**, escolle unha disposición: stereo, 5.1, 5.1.2, 5.1.4, 7.1 ou 7.1.4.
3. Comproba o formato de saída, a cantidade de canles e os axustes de nivel e exporta.
4. Le o informe de entrega e escoita o ficheiro exportado na disposición de altofalantes correspondente.

## Comprobar o resultado

A saída contén PCM renderizado para altofalantes na orde de canles declarada. Esta opción de exportación non cambia a monitorización do proxecto nin a creación ADM orixinal. Revisa no informe o renderizador e a disposición utilizados.

## Límites e recuperación

O renderizado EAR de altofalantes non se pode combinar co renderizado para auriculares. As saídas divididas e o passthrough BW64/ADM non admiten esta opción. As canles renderizadas non levan os metadatos ADM orixinais para bed/object; usa BW64 sen renderizar para ese intercambio. Os obxectos móbiles ou difusos, HOA, a xestión de graves e o renderizado Dolby certificado quedan fóra desta función. O medidor normal de sonoridade admite como máximo oito canles de saída.
