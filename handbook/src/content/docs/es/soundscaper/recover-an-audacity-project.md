---
title: "Recuperar audio de un proyecto de Audacity dañado"
description: "Evalúa un proyecto dañado y guarda el trabajo recuperado en una copia independiente."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"es"} -->

Evalúa un proyecto dañado y guarda el trabajo recuperado en una copia independiente.

## Antes de empezar

Haz primero una copia del proyecto de Audacity dañado. Conserva juntos los archivos complementarios disponibles. La recuperación admite archivos `.aup3` y proyectos de Audacity sin guardar compatibles, pero no puede recrear muestras que ya no existen.

## Pasos

1. Abre **Archivo > Gestión de proyectos > Recuperar proyecto Audacity**.
2. Selecciona el proyecto dañado. Lee la **Recovery assessment** antes de importar o guardar nada.
3. Inspecciona los **Missing audio ranges**, incluidas las páginas adicionales con ubicaciones afectadas.
4. Cuando esté disponible, elige **Save repaired Audacity copy**. Si no, abre el resultado recuperado, revisa su informe de compatibilidad y guarda el trabajo con un nombre nuevo.

## Comprobar el resultado

Reproduce las secciones recuperadas y compara los huecos o silencios con el informe. Confirma que se abre la copia nueva antes de confiar en ella. Conserva el archivo original dañado para volver a intentar la recuperación.

## Límites y recuperación

Es posible recuperar prefijos de audio válidos y sustituir las muestras que faltan por silencio. Reparar una base de datos no implica que se haya conservado todo el audio ni que se transfieran todas las funciones de edición nativas. Lee las omisiones indicadas y nunca sobrescribas tu único original durante el diagnóstico. Para proyectos intactos, usa la [guía de importación de Audacity](/guides/projects/open-an-audacity-project/).
