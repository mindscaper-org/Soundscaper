---
title: "Usar complementos de audio de escritorio"
description: "Busca, habilita y prueba efectos e instrumentos nativos en Soundscaper de escritorio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"es"} -->

Busca, habilita y prueba efectos e instrumentos nativos en Soundscaper de escritorio.

## Antes de empezar

Instala una versión del complemento compatible con tu sistema operativo y con el formato de host admitido. Los complementos incluidos con la aplicación de escritorio están disponibles de forma predeterminada en los paquetes compatibles; los complementos adicionales requieren búsqueda y los permisos que correspondan.

## Pasos

1. Abre **Efecto > Administrador de plugins**. Busca en la lista y usa **Escaneo y configuración** para configurar la detección.
2. Selecciona el complemento y revisa su versión, permisos y opciones de recuperación. Habilítalo cuando corresponda.
3. Añade un efecto desde **Efecto > Efectos de plugins de audio** o un rack en tiempo real. Elige los instrumentos nativos desde los controles de instrumento de la pista MIDI.
4. Escucha la reproducción, guarda un ajuste preestablecido si te resulta útil y guarda el proyecto.

## Tocar con un amplificador de guitarra

Añade **OrbitAmp** desde **Efecto > Efectos de plugins de audio** o desde el rack de efectos en tiempo real de una pista. Abre el editor del complemento y elige un amplificador en la sección **AMP** y una pantalla de altavoces en la sección **CAB**. El paquete de escritorio incluye los sonidos de fábrica.

## Comprobar el resultado

El complemento previsto debe procesar el sonido y volver a cargarse con sus ajustes guardados cuando esté disponible el mismo binario compatible. Omítelo para comparar y comprueba la exportación antes de entregarla.

## Límites y recuperación

Los paquetes de Windows admiten las rutas mantenidas de puente VST2, incluidos los complementos de 32 bits compatibles. En Linux se pueden usar VST3 de Windows con una configuración yabridge/Wine instalada y configurada; esto no instala ni licencia complementos de terceros. Los ajustes preestablecidos no incluyen binarios. Si falla un complemento, usa los controles de recuperación del Administrador de complementos y prueba una versión compatible antes de reanudar el trabajo.
