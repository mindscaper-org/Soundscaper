---
title: "Igualar el tono de una grabación de voz"
description: "Aprende una referencia tonal y usa Match EQ para acercar otra grabación a ella."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"es"} -->

Aprende una referencia tonal y usa Match EQ para acercar otra grabación a ella.

## Antes de empezar

Elige una referencia audible de ancho de banda completo de al menos un cuarto de segundo; de preferencia, la misma persona grabada en buenas condiciones. Ten preparada la grabación objetivo. El procesamiento es local tanto en el navegador como en la aplicación de escritorio.

## Pasos

1. Selecciona la referencia y abre **Efecto > Ecualizador y filtros > Match EQ**. Elige **Learn reference from selection**.
2. Guarda la referencia aprendida como ajuste preestablecido si quieres reutilizar este perfil de voz. Cierra el cuadro de diálogo.
3. Selecciona el objetivo, vuelve a abrir Match EQ, recupera la referencia si hace falta y elige **Analyze target**.
4. Con **Original**, compara **Matched (level compensated)** con **Preview**. Ajusta la corrección y elige **Aplicar a la selección** o **Edit as Filter Curve EQ** para modificar la curva.

## Comprobar el resultado

Escucha a un volumen parecido para comprobar si el equilibrio tonal es más similar. El audio procesado mantiene su duración y número de canales. **Deshacer** revierte la aplicación.

## Límites y recuperación

Match EQ no puede restaurar un ancho de banda ausente ni igualar la interpretación, la dinámica, la reverberación de la sala o la identidad de la voz. La captura de referencia incluye los efectos de pista antes de los buses y el master; el objetivo se analiza antes del rack de su pista. Renderiza primero la referencia si el sonido deseado depende del procesamiento posterior.
