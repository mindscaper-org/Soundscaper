---
title: "Reducir el ruido durante la reproducción"
description: "Añade un efecto de reducción de ruido con IA en tiempo real a una pista de diálogo."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"es"} -->

Añade un efecto de reducción de ruido con IA en tiempo real a una pista de diálogo.

## Antes de empezar

Usa Soundscaper de escritorio. Abre **Herramientas > Administrador de modelos** e instala el modelo de reducción de ruido en tiempo real compatible y el runtime que ofrezca tu compilación. La instalación del modelo es una descarga explícita; el navegador por sí solo no puede ejecutar este efecto nativo.

## Pasos

1. Selecciona la pista de diálogo ruidosa y abre su rack de efectos en tiempo real.
2. Elige **Añadir efecto** y selecciona **AI denoising (DPDFNet2)**.
3. Inicia la reproducción y compara el sonido con el efecto omitido usando su botón de encendido.
4. Ajusta la mezcla alrededor de la pista limpiada y escucha la exportación antes de entregarla. Guarda el proyecto para conservar el rack.

## Comprobar el resultado

El ruido debería disminuir mientras el habla sigue siendo inteligible. Comprueba las consonantes suaves, las respiraciones y el comienzo de la reproducción. Si oyes bombeo o falta habla, omite el efecto y compara con el original.

## Límites y recuperación

Esta función reduce el ruido de voz; no es un efecto general de restauración musical. Para reproducir el proyecto en otro ordenador hacen falta el modelo compatible y el runtime nativo. Si el efecto no está disponible, comprueba la instalación y la compatibilidad con escritorio; si necesitas un resultado renderizado y revisado, usa la [restauración de voz sin conexión](/soundscaper/restore-damaged-speech/). Descargar un modelo no garantiza que mejore todas las grabaciones.
