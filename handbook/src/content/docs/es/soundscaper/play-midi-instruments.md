---
title: "Reproducir MIDI con un instrumento"
description: "Elige un sintetizador para las notas MIDI y conserva la interpretación editable."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"es"} -->

Elige un sintetizador para las notas MIDI y conserva la interpretación editable.

## Antes de empezar

Abre o importa MIDI, o crea una pista nueva en Soundscaper. Las opciones de reproducción integradas varían según los instrumentos nativos opcionales. Los instrumentos de complementos nativos requieren la aplicación de escritorio y el complemento correspondiente habilitado.

## Pasos

1. Si necesitas una pista, elige **Menú de pistas > Añadir nueva pista > MIDI track (beta)**.
2. Abre **Ventana > Piano roll (beta)**. Añade notas o selecciona material MIDI existente.
3. Elige **Instrument**. Para un instrumento nativo, abre **Instrument settings** para ajustar el sonido y guardar un ajuste preestablecido.
4. Inicia la reproducción, comprueba las notas y el sustain y guarda el proyecto. Vuelve a abrirlo.

## Comprobar el resultado

Deberías oír el instrumento seleccionado y las notas deberían seguir siendo editables en el piano roll. Los ajustes y las preselecciones del instrumento deberían restaurarse al volver a abrir el proyecto si está instalado el complemento requerido.

## Límites y recuperación

Los instrumentos nativos se ofrecen en pistas MIDI, no en pistas de audio normales. Un ajuste guardado no incluye el binario del complemento ni sus bibliotecas externas. Los instrumentos incluidos están habilitados de forma predeterminada en los paquetes de escritorio compatibles; otros pueden necesitar el [Administrador de complementos](/soundscaper/use-desktop-plugins/). Comprueba la reproducción y la exportación en el ordenador de destino antes de contar con el mismo timbre.
