---
title: "Usar complementos de audio de escritorio"
description: "Busca, habilita y prueba efectos e instrumentos nativos en Soundscaper de escritorio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","targetLocale":"es"} -->

Busca, habilita y prueba efectos e instrumentos nativos en Soundscaper de escritorio.

## Antes de empezar

Instala una versión del complemento compatible con tu sistema operativo y con el formato de host admitido. Los complementos incluidos con la aplicación de escritorio están disponibles de forma predeterminada en los paquetes compatibles; los complementos adicionales requieren búsqueda y los permisos que correspondan.

## Pasos

1. Abre **Efecto > Administrador de plugins**. Busca en la lista y usa **Escaneo y configuración** para configurar la detección.
2. Selecciona el complemento y revisa su versión, permisos y opciones de recuperación. Habilítalo cuando corresponda.
3. Añade un efecto desde **Efecto > Efectos de plugins de audio** o un rack en tiempo real. Elige los instrumentos nativos desde los controles de instrumento de la pista MIDI.
4. Escucha la reproducción, guarda un ajuste preestablecido si te resulta útil y guarda el proyecto.

## Comprobar el resultado

El complemento previsto debe procesar el sonido y volver a cargarse con sus ajustes guardados cuando esté disponible el mismo binario compatible. Omítelo para comparar y comprueba la exportación antes de entregarla.

## Límites y recuperación

Los paquetes de Windows admiten las rutas mantenidas de puente VST2, incluidos los complementos de 32 bits compatibles. En Linux se pueden usar VST3 de Windows con una configuración yabridge/Wine instalada y configurada; esto no instala ni licencia complementos de terceros. Los ajustes preestablecidos no incluyen binarios. Si falla un complemento, usa los controles de recuperación del Administrador de complementos y prueba una versión compatible antes de reanudar el trabajo.
