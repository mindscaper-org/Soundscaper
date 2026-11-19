---
title: "Reducir a fuga entre micrófonos de diálogo"
description: "Crea envolventes de ganancia editables que baixan a fuga correlacionada en micrófonos inactivos."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"gl"} -->

Crea envolventes de ganancia editables que baixan a fuga correlacionada en micrófonos inactivos.

## Antes de comezar

Usa entre dúas e oito pistas de diálogo aliñadas no tempo, idealmente un micrófono por persoa e ganancias de gravación comparables. Selecciona un intervalo temporal positivo con audio en todas as pistas escollidas. Desbloquea e desconxela esas pistas.

## Pasos

1. Selecciona as pistas dos micrófonos e a pasaxe que queres procesar.
2. Abre **Efecto > Eliminación e reparación de ruído > Automatic microphone-bleed reduction**.
3. Comeza coa configuración predeterminada e escolle **Create gain envelopes**.
4. Reproduce a pasaxe, en especial as interrupcións e a fala solapada. Usa a **Ganancia do clip** para axustar os puntos xerados que baixen a fala desexada.

## Comprobar o resultado

Os puntos de ganancia reducen a fuga e mantéñense as fontes orixinais e as posicións dos clips. Comproba as entradas de cada falante e os límites da selección. **Desfacer** elimina a operación; **Refacer** volve aplicala.

## Límites e recuperación

A función non aliña gravacións nin separa voces dentro dun micrófono activo. As diferenzas grandes de ganancia, a reverberación e a fala baixa baixo unha fuga alta poden causar erros. Se probas outros axustes, desfai primeiro a aplicación inicial, pois volver aplicala acumula a atenuación. Non se poden procesar seleccións espectrais nin pistas bloqueadas ou conxeladas.
