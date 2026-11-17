---
title: "Analisar o som durante a reprodução"
description: "Utilize o painel Analysis para ver o espectro em directo, a intensidade sonora, o estéreo e um relatório de áudio ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"pt-PT"} -->

Utilize o painel Analysis para ver o espectro em directo, a intensidade sonora, o estéreo e um relatório de áudio ACX.

## Antes de começar

Abra um projecto com áudio. Decida se pretende inspeccionar a reprodução ou um intervalo seleccionado: uma selecção de tempo pode alterar o espectro para a análise da selecção.

## Passos

1. Abra **Analisar > Análise**. Expanda as secções necessárias, como **Spectrum**, espectrograma, intensidade sonora ou correlação.
2. Limpe a selecção de tempo e inicie a reprodução para ver a análise em directo. Compare as sobreposições das faixas no espectro para localizar bandas de frequência concorrentes.
3. Pare e seleccione um trecho para inspeccionar o respectivo espectro sem reprodução.
4. Para verificações de audiolivros, expanda **ACX compliance** e escolha **Check audio**. Leia a tabela de resultados; utilize **Exportação** para obter o relatório JSON.

## Verificar o resultado

Os ecrãs em directo respondem à reprodução. Um relatório ACX indica aprovação ou reprovação nas verificações de áudio, em vez de apenas mostrar um medidor. Corrija os níveis ou as definições de formato que falharam e volte a verificar.

## Limites e recuperação

Um espectro mostra energia, não se a mistura soa bem. A correlação e a intensidade sonora têm de ser avaliadas no contexto e através da audição. As verificações ACX não garantem aceitação por um serviço de publicação nem cobrem todos os requisitos editoriais. Recolher a secção ACX limpa a verificação apresentada; volte a executá-la quando necessário. Feche as secções de análise que não utiliza para reduzir o trabalho de apresentação.
