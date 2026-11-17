---
title: "Alinhar uma nova tomada de diálogo"
description: "Ajuste uma segunda interpretação das mesmas palavras a um clip de referência."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","targetLocale":"pt-PT"} -->

Ajuste uma segunda interpretação das mesmas palavras a um clip de referência.

## Antes de começar

Prepare dois clips de áudio mono ou estéreo desbloqueados, cada um com 0,25–30 segundos. Devem conter as mesmas palavras e uma interpretação razoavelmente semelhante. Renderize ou desligue primeiro o material ligado a vídeo ou ancorado ao ritmo.

## Passos

1. Abra **Editar > Clips de áudio > Align dialogue**.
2. Escolha explicitamente a referência e a substituição e defina a intensidade do alinhamento.
3. Escolha **Analyze and align**. Compare **Play reference**, **Play replacement** e **Play aligned**. Ouça atentamente as consoantes e as respirações.
4. Escolha **Create aligned copy** apenas quando o resultado soar bem.

## Verificar o resultado

Uma nova faixa contém uma cópia alinhada com o início e a duração da referência. Os originais continuam disponíveis. **Desfazer** remove a cópia criada num só passo. Guarde e volte a abrir o projecto para continuar a utilizar o resultado renderizado sem repetir a análise.

## Limites e recuperação

A substituição deve ter entre metade e o dobro da duração da referência. O alinhamento é acústico: não analisa os lábios nem verifica uma transcrição. Palavras diferentes, ruído de fundo ou vozes sobrepostas podem inviabilizá-lo. Se a análise não aceitar a correspondência, utilize frases mais curtas que coincidam ou edite manualmente. Alterar as entradas ou a intensidade requer uma nova análise.
