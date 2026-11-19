---
title: "Aplicar efectos en tempo real a un clip"
description: "Asigna ao clip de audio o seu propio rack de efectos sen procesar todos os clips da pista."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"gl"} -->

Asigna ao clip de audio o seu propio rack de efectos sen procesar todos os clips da pista.

## Antes de comezar

Selecciona un clip de audio en Soundscaper. Os efectos do clip forman parte do seu procesamento e alimentan os efectos da pista; o procesamento da pista e do master aínda pode modificar o son que escoitas.

## Pasos

1. Abre **Xanela > Propiedades do clip** e expande **Efectos**. Este é o rack de efectos do clip.
2. Escolle **Engade efecto**, selecciona un efecto e axusta a súa configuración. Reproduce o clip para escoitalo.
3. Usa o botón de acendido do efecto para comparar o son procesado co efecto omitido. Reordena ou elimina efectos do rack se fai falta.
4. Garda o proxecto e escoita o clip xunto cos contiguos. Usa **Desfacer** se o cambio non axuda.

## Comprobar o resultado

O clip seleccionado ten o seu procesamento, mentres que os demais conservan a súa configuración. Escoita máis alá do final por se hai unha cola de reverberación ou retardo; comproba o rack da pista se o resultado combinado é excesivo.

## Límites e recuperación

A cola dun efecto pode durar máis ca o audio de orixe do clip; comproba as opcións de cola ao exportar antes da entrega. Para un detector Auto Duck, escolle outra pista adecuada; rexeítanse os bucles de realimentación. Abre **Máis opcións > Auto-idle** na cabeceira do efecto para controlar o repouso durante o silencio. Desactívao nos complementos sensibles á temporización. Consulta [procesamento local](/help/local-processing/) para ver axustes relacionados.
