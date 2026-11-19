---
title: "Inspecionar o áudio enquanto ele toca"
description: "Use o painel Analysis para ver espectro ao vivo, volume, estéreo e um relatório de áudio ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"pt-BR"} -->

Use o painel Analysis para ver espectro ao vivo, volume, estéreo e um relatório de áudio ACX.

## Antes de começar

Abra um projeto com áudio. Decida se deseja inspecionar a reprodução ou um trecho selecionado: uma seleção de tempo pode mudar o espectro para a análise do trecho.

## Etapas

1. Abra **Analisar > Análise**. Expanda as seções necessárias, como **Spectrum**, espectrograma, volume ou correlação.
2. Limpe a seleção de tempo e inicie a reprodução para obter uma visualização ao vivo. Compare as sobreposições das faixas no espectro para localizar bandas de frequência concorrentes.
3. Pare e selecione um trecho para inspecionar o espectro sem reprodução.
4. Para verificar audiolivros, expanda **ACX compliance** e escolha **Check audio**. Leia a tabela de resultados; use **Exportação** para obter o relatório JSON.

## Verifique o resultado

Os painéis ao vivo respondem à reprodução. Um relatório ACX indica aprovação ou reprovação nas verificações de áudio, em vez de apenas mostrar um medidor. Corrija níveis ou configurações de formato que falharam e verifique novamente.

## Limites e recuperação

O espectro mostra energia, não se a mixagem soa bem. Correlação e volume precisam de contexto e de uma avaliação auditiva. As verificações ACX não garantem a aceitação por um serviço de publicação nem cobrem todos os requisitos editoriais. Recolher a seção ACX limpa a verificação exibida; execute-a novamente quando necessário. Feche as seções de análise que não usa para reduzir o trabalho de exibição.
