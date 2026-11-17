---
title: "Recortar o audio falado a partir da transcrición"
description: "Selecciona palabras nunha transcrición temporizada para navegar e editar o audio correspondente."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","targetLocale":"gl"} -->

Selecciona palabras nunha transcrición temporizada para navegar e editar o audio correspondente.

## Antes de comezar

Abre un proxecto que conteña fala. Para xerar unha nova transcrición cómpre a aplicación de escritorio, un modelo local compatible instalado e o teu consentimento explícito. Pódese usar unha transcrición temporizada existente sen xerala de novo.

## Pasos

1. Abre **Editar > Transcript-based editing**.
2. Escolle **Generate transcript** cando estea dispoñible e sigue as indicacións sobre o modelo e os permisos. Agarda a que remate o procesamento das pistas de audio.
3. Fai clic nunha palabra para ir ao seu audio. Fai dobre clic para seleccionala e comproba o intervalo resaltado na liña de tempo.
4. Co foco na transcrición, preme **Backspace** ou **Eliminar** para eliminar as palabras seleccionadas e o audio asociado. Escoita a unión e usa **Desfacer** se cómpre.

## Comprobar o resultado

A transcrición e a edición de audio cambian xuntas e a pasaxe seleccionada faise visible sen cambiar o zoom. Garda, pecha e volve abrir o panel para seguir traballando coa transcrición conservada.

## Límites e recuperación

A transcrición e a temporización das palabras poden ser incorrectas: escoita antes de eliminar. O editor web indica que a xeración só está dispoñible na aplicación de escritorio; non descarga nin executa un modelo. A transcrición axuda na edición, pero non garante un rexistro literal. Garda unha [instantánea](/soundscaper/save-session-snapshots/) antes de facer cortes importantes no diálogo.
