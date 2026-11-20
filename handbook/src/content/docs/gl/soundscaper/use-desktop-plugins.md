---
title: "Usar complementos de audio de escritorio"
description: "Busca, activa e escoita efectos e instrumentos nativos en Soundscaper para escritorio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"gl"} -->

Busca, activa e escoita efectos e instrumentos nativos en Soundscaper para escritorio.

## Antes de comezar

Instala unha versión do complemento compatible co teu sistema operativo e cun formato de host admitido. Os complementos de escritorio incluídos están dispoñibles por defecto nos paquetes compatibles; os adicionais requiren detección e os permisos necesarios.

## Pasos

1. Abre **Efecto > Xestor de complementos**. Busca na lista e usa **Exploración e axustes** para as opcións de detección.
2. Selecciona o complemento e revisa a versión, os permisos e os controis de recuperación. Actívao cando corresponda.
3. Engade un efecto desde **Efecto > Complementos de son** ou un rack en tempo real. Selecciona os instrumentos nativos cos controis do instrumento da pista MIDI.
4. Escoita a reprodución, garda un preaxuste se che resulta útil e garda o proxecto.

## Tocar cun amplificador de guitarra

Engade **OrbitAmp** desde **Efecto > Complementos de son** ou desde o rack de efectos en tempo real dunha pista. Abre o editor do complemento e escolle un amplificador na sección **AMP** e unha caixa de altofalantes na sección **CAB**. O paquete de escritorio inclúe os sons de fábrica.

## Comprobar o resultado

O complemento desexado debe procesar o son e volver cargarse cos axustes gardados se está dispoñible o mesmo binario compatible. Omíteo para comparar e revisa a exportación antes da entrega.

## Límites e recuperación

Os paquetes de Windows admiten as rutas mantidas de ponte VST2, incluídos os complementos de 32 bits compatibles. En Linux pódese usar Windows VST3 cunha instalación de yabridge/Wine configurada; isto non instala nin licencia complementos de terceiros. Os preaxustes non inclúen binarios. Se falla un complemento, usa os controis de recuperación do Xestor de complementos e proba unha versión compatible antes de continuar.
