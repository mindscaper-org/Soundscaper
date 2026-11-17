---
title: "Analizar el sonido mientras se reproduce"
description: "Usa el panel Análisis para consultar el espectro y la sonoridad en directo, comprobar el estéreo y generar un informe ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"es"} -->

Usa el panel Análisis para consultar el espectro y la sonoridad en directo, comprobar el estéreo y generar un informe ACX.

## Antes de empezar

Abre un proyecto con audio. Decide si quieres revisar la reproducción o un intervalo seleccionado: una selección de tiempo puede cambiar el espectro al análisis de la selección.

## Pasos

1. Abre **Analizar > Análisis**. Despliega las secciones necesarias, como **Spectrum**, espectrograma, sonoridad o correlación.
2. Borra la selección de tiempo e inicia la reproducción para ver los datos en directo. Compara las superposiciones de pistas en el espectro para localizar bandas de frecuencia que compiten.
3. Detén la reproducción y selecciona un pasaje para inspeccionar su espectro sin reproducirlo.
4. Para revisar audiolibros, despliega **ACX compliance** y elige **Check audio**. Lee la tabla de resultados y usa **Exportar** para obtener el informe JSON.

## Comprobar el resultado

Las visualizaciones en directo responden a la reproducción. El informe ACX indica si se superan o no las comprobaciones de audio, en lugar de mostrar solo un medidor. Corrige los niveles o ajustes de formato que no cumplan y vuelve a comprobarlos.

## Límites y recuperación

El espectro muestra energía, no si la mezcla suena bien. La correlación y la sonoridad requieren contexto y escucha. Las comprobaciones de audio de ACX no garantizan la aceptación de un servicio de publicación ni cubren todos los requisitos editoriales. Al contraer la sección ACX se borra la comprobación mostrada; ejecútala de nuevo cuando haga falta. Cierra las secciones del analizador que no necesites para reducir el trabajo de visualización.
