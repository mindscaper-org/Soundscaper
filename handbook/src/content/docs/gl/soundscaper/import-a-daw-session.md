---
title: "Importar unha sesión de audio doutro editor"
description: "Importa edicións de audio compatibles, volve conectar os seus medios e revisa os límites da conversión."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"gl"} -->

Importa edicións de audio compatibles, volve conectar os seus medios e revisa os límites da conversión.

## Antes de comezar

Copia a sesión e o seu audio nun cartafol accesible. Admítense importacións de sesións nativas de REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, sesións de SoundCraft e Audition `.sesx` ou a versión antiga `.ses`. Conserva o proxecto orixinal.

## Pasos

1. Escolle **Ficheiro > Abrir** ou **Ficheiro > Importar**, ou arrastra a sesión ao espazo de traballo.
2. No navegador, selecciona o audio asociado xunto coa sesión. No escritorio, concede acceso ao cartafol de medios cando se solicite.
3. Abre **Ficheiro > Informe de entrega**. Le as omisións e conversións e volve ligar os medios sen conexión cando faga falta.
4. Escoita edicións e fundidos representativos, revisa a orde e a temporización das pistas e garda un proxecto Scape novo.

## Comprobar o resultado

Os cortes importados deben coincidir co audio de orixe accesible. Compara o resultado cunha mestura de referencia do editor orixinal, especialmente cando importan o procesamento, o enrutamento ou a automatización.

## Límites e recuperación

A importación nativa converte as edicións de audio, pero non garante mesturas idénticas. Os detalles compatibles varían segundo o formato; non se executan os complementos da sesión de orixe. REAPER usa as tomas de audio activas e omite a creación de tomas alternativas, MIDI, enrutamento e complementos. Para intercambiar con outra DAW, usa formatos de intercambio admitidos como AES31 ADL ou DAWproject en vez de agardar que se escriba unha sesión nativa.
