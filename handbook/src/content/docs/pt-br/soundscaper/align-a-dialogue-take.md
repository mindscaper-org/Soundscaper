---
title: "Alinhar uma nova tomada de diálogo"
description: "Ajuste uma segunda interpretação das mesmas palavras a um clipe de referência."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","targetLocale":"pt-BR"} -->

Ajuste uma segunda interpretação das mesmas palavras a um clipe de referência.

## Antes de começar

Prepare dois clipes de áudio mono ou estéreo desbloqueados, cada um com 0,25–30 segundos. Eles devem ter as mesmas palavras e interpretações razoavelmente semelhantes. Renderize ou desvincule primeiro o material associado a vídeo ou ancorado à batida.

## Etapas

1. Abra **Editar > Clipes de áudio > Align dialogue**.
2. Escolha explicitamente a referência e a substituição e defina a intensidade do alinhamento.
3. Escolha **Analyze and align**. Compare **Play reference**, **Play replacement** e **Play aligned**. Ouça atentamente as consoantes e as respirações.
4. Escolha **Create aligned copy** somente depois que o resultado soar correto.

## Verifique o resultado

Uma nova faixa contém uma cópia alinhada ao início e à duração da referência. Os originais continuam disponíveis. **Desfazer** remove a cópia criada em uma etapa. Salve e reabra o projeto para continuar usando o resultado renderizado sem repetir a análise.

## Limites e recuperação

A substituição deve ter entre metade e o dobro da duração da referência. O alinhamento é acústico, não analisa os lábios nem confere uma transcrição. Palavras diferentes, ruído de fundo ou falas sobrepostas podem prejudicá-lo. Se a análise recusar a correspondência, use frases menores que coincidam ou edite manualmente. Alterar as entradas ou a intensidade exige nova análise.
