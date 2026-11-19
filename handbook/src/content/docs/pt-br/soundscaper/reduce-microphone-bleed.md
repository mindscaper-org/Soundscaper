---
title: "Reduzir o vazamento entre microfones de diálogo"
description: "Crie envelopes de ganho editáveis para baixar o vazamento correlacionado em microfones inativos."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"pt-BR"} -->

Crie envelopes de ganho editáveis para baixar o vazamento correlacionado em microfones inativos.

## Antes de começar

Use de duas a oito faixas de diálogo alinhadas no tempo, de preferência um microfone por pessoa e ganhos de gravação semelhantes. Selecione um intervalo de tempo positivo com áudio em todas as faixas escolhidas. Desbloqueie e descongele essas faixas.

## Etapas

1. Selecione as faixas dos microfones e o trecho a processar.
2. Abra **Efeito > Remoção e reparo de ruído > Automatic microphone-bleed reduction**.
3. Comece com as configurações padrão e escolha **Create gain envelopes**.
4. Reproduza o trecho, especialmente interrupções e falas sobrepostas. Use **Ganho do clipe** para ajustar pontos gerados que reduzam uma fala desejada.

## Verifique o resultado

Os pontos de ganho reduzem o vazamento enquanto as fontes originais e as posições dos clipes continuam disponíveis. Confira as entradas de cada locutor e os limites da seleção. **Desfazer** remove a operação; **Refazer** a reaplica.

## Limites e recuperação

O recurso não alinha gravações nem separa vozes dentro de um microfone ativo. Grandes diferenças de ganho, reverberação e fala baixa sob vazamento alto podem causar erros. Para testar configurações diferentes, desfaça a primeira aplicação: aplicar novamente acumula a atenuação. Seleções espectrais, faixas bloqueadas e faixas congeladas não podem ser processadas.
