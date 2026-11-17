---
title: "Reproducir MIDI cun instrumento"
description: "Escolle un sintetizador para as notas MIDI e conserva a interpretación editable."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"gl"} -->

Escolle un sintetizador para as notas MIDI e conserva a interpretación editable.

## Antes de comezar

Abre ou importa MIDI, ou crea unha pista nova en Soundscaper. As opcións de reprodución integradas varían segundo os instrumentos nativos opcionais. Os instrumentos de complementos nativos requiren a aplicación de escritorio e o complemento correspondente activado.

## Pasos

1. Se necesitas unha pista, escolle **Pistas > Engadir pista nova > MIDI track (beta)**.
2. Abre **Xanela > Piano roll (beta)**. Engade notas ou selecciona material MIDI existente.
3. Escolle **Instrument**. Para un instrumento nativo, abre **Instrument settings** para axustar o son e gardar un preaxuste.
4. Inicia a reprodución, comproba as notas e o sustain, garda o proxecto e ábreo de novo.

## Comprobar o resultado

Deberías escoitar o instrumento seleccionado e as notas deberían seguir editables no piano roll. A configuración e os preaxustes do instrumento deberían recuperarse ao abrir de novo o proxecto se está instalado o complemento necesario.

## Límites e recuperación

Os instrumentos nativos están dispoñibles en pistas MIDI, non nas pistas de audio normais. Un preaxuste gardado non inclúe o binario do complemento nin as súas bibliotecas externas. Os instrumentos incluídos están activados por defecto nos paquetes de escritorio compatibles; outros poden precisar o [Xestor de complementos](/soundscaper/use-desktop-plugins/). Comproba a reprodución e a exportación no ordenador de destino antes de depender do mesmo timbre.
