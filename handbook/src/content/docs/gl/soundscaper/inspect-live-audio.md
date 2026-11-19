---
title: "Analizar o son mentres se reproduce"
description: "Usa o panel Análise para ver o espectro e a sonoridade en directo, facer comprobacións estéreo e crear un informe ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"gl"} -->

Usa o panel Análise para ver o espectro e a sonoridade en directo, facer comprobacións estéreo e crear un informe ACX.

## Antes de comezar

Abre un proxecto con audio. Decide se queres revisar a reprodución ou un intervalo seleccionado: unha selección de tempo pode cambiar o espectro á análise da selección.

## Pasos

1. Abre **Analizar > Análise**. Expande as seccións que necesites, como **Spectrum**, espectrograma, sonoridade ou correlación.
2. Borra a selección de tempo e inicia a reprodución para obter unha vista en directo. Compara as superposicións das pistas no espectro para localizar bandas de frecuencia concorrentes.
3. Detén a reprodución e selecciona unha pasaxe para inspeccionar o seu espectro sen reproducila.
4. Para revisar audiolibros, expande **ACX compliance** e escolle **Check audio**. Le a táboa de resultados e usa **Exportar** para obter o informe JSON.

## Comprobar o resultado

As visualizacións en directo responden á reprodución. O informe ACX indica se se superan ou non as comprobacións de audio en vez de mostrar só un medidor. Corrixe os niveis ou os axustes de formato que non cumpran e comproba outra vez.

## Límites e recuperación

O espectro mostra enerxía, non se a mestura soa ben. A correlación e a sonoridade requiren contexto e escoita. As comprobacións ACX non garanten a aceptación dun servizo de publicación nin revisan todos os requisitos editoriais. Ao contraer a sección ACX bórrase a comprobación mostrada; execútaa de novo cando faga falta. Pecha as seccións do analizador que non necesites para reducir o traballo de visualización.
