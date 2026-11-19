---
title: "Reduzir a fuga entre microfones de diálogo"
description: "Crie envelopes de ganho editáveis para baixar a fuga correlacionada em microfones inactivos."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"pt-PT"} -->

Crie envelopes de ganho editáveis para baixar a fuga correlacionada em microfones inactivos.

## Antes de começar

Utilize entre duas e oito faixas de diálogo alinhadas no tempo, idealmente um microfone por pessoa e ganhos de gravação comparáveis. Seleccione um intervalo de tempo positivo com áudio em todas as faixas escolhidas. Desbloqueie as faixas e descongele-as.

## Passos

1. Seleccione as faixas dos microfones e o trecho a processar.
2. Abra **Efeito > Remoção e reparação de ruído > Automatic microphone-bleed reduction**.
3. Comece pelas definições predefinidas e escolha **Create gain envelopes**.
4. Reproduza o trecho, especialmente as interrupções e a fala sobreposta. Utilize **Ganho do clipe** para ajustar quaisquer pontos gerados que baixem a fala pretendida.

## Verificar o resultado

Os pontos de ganho reduzem a fuga, mantendo disponíveis as fontes originais e as posições dos clips. Verifique as entradas de cada locutor e os limites da selecção. **Desfazer** remove a operação; **Refazer** volta a aplicá-la.

## Limites e recuperação

A funcionalidade não alinha gravações nem separa vozes dentro de um microfone activo. Grandes diferenças de ganho, reverberação e fala baixa sob fuga intensa podem causar erros. Para experimentar outras definições, anule a primeira aplicação: voltar a aplicar acumula a atenuação. Selecções espectrais, faixas bloqueadas e faixas congeladas não podem ser processadas.
