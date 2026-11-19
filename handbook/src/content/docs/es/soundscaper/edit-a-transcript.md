---
title: "Cortar el audio hablado a partir de la transcripción"
description: "Selecciona palabras en una transcripción temporizada para navegar hasta su audio y editarlo."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","targetLocale":"es"} -->

Selecciona palabras en una transcripción temporizada para navegar hasta su audio y editarlo.

## Antes de empezar

Abre un proyecto con habla. Para generar una transcripción nueva se necesita la aplicación de escritorio, un modelo local compatible instalado y tu consentimiento explícito. Puedes usar una transcripción temporizada existente sin generarla otra vez.

## Pasos

1. Abre **Editar > Transcript-based editing**.
2. Cuando esté disponible, elige **Generate transcript** y sigue las indicaciones sobre el modelo y los permisos. Espera a que terminen de procesarse las pistas de audio.
3. Haz clic en una palabra para ir a su audio. Haz doble clic para seleccionarla y comprueba el intervalo resaltado en la línea de tiempo.
4. Con el foco en la transcripción, pulsa **Backspace** o **Eliminar** para eliminar las palabras seleccionadas y el audio asociado. Escucha la unión y usa **Deshacer** si hace falta.

## Comprobar el resultado

La transcripción y la edición de audio cambian a la vez; el pasaje seleccionado se hace visible sin modificar el zoom. Guarda, cierra y vuelve a abrir el panel para seguir trabajando con la transcripción conservada.

## Límites y recuperación

La transcripción y la temporización de las palabras pueden ser incorrectas: escucha antes de borrar. El editor web explica que la generación solo está disponible en la aplicación de escritorio y no descarga ni ejecuta un modelo. La transcripción ayuda a editar, pero no garantiza un registro literal. Guarda una [instantánea](/soundscaper/save-session-snapshots/) antes de hacer cortes importantes en un diálogo.
