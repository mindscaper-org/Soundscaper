---
title: "Importar una sesión de audio de otro editor"
description: "Importa ediciones de audio compatibles, vuelve a conectar sus medios y revisa los límites de conversión."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"es"} -->

Importa ediciones de audio compatibles, vuelve a conectar sus medios y revisa los límites de conversión.

## Antes de empezar

Copia la sesión y su audio en una carpeta accesible. Se admiten sesiones de audio nativas de REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, sesiones de SoundCraft y Audition `.sesx` o la versión antigua `.ses`. Conserva el proyecto original.

## Pasos

1. Elige **Archivo > Abrir** o **Archivo > Importar**, o arrastra la sesión al espacio de trabajo.
2. En el navegador, selecciona junto a la sesión el audio que la acompaña. En escritorio, concede acceso a la carpeta de medios cuando se solicite.
3. Abre **Archivo > Informe de entrega**. Lee las omisiones y conversiones y vuelve a vincular los medios sin conexión cuando haga falta.
4. Escucha ediciones y fundidos representativos, inspecciona el orden y el tiempo de las pistas y guarda un proyecto Scape nuevo.

## Comprobar el resultado

Los cortes importados deben coincidir con el audio de origen accesible. Compara el resultado con una mezcla de referencia del editor original, sobre todo cuando importen el procesamiento, el enrutamiento o la automatización.

## Límites y recuperación

La importación nativa convierte ediciones de audio, pero no garantiza mezclas idénticas. Los detalles compatibles varían según el formato; no se ejecutan los complementos de la sesión de origen. REAPER usa las tomas de audio activas y omite la creación de tomas alternativas, MIDI, enrutamiento y complementos. Para intercambiar con otro DAW, usa formatos de intercambio compatibles como AES31 ADL o DAWproject; no esperes que se escriba una sesión nativa.
