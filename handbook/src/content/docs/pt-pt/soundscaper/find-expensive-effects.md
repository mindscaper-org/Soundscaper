---
title: "Encontrar efeitos que sobrecarregam a CPU durante a reprodução"
description: "Compare o custo dos efeitos em tempo real antes de decidir que processamento simplificar."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"pt-PT"} -->

Compare o custo dos efeitos em tempo real antes de decidir que processamento simplificar.

## Antes de começar

Utilize um projecto com efeitos em tempo real e um trecho representativo com bastante actividade. As medições descrevem este dispositivo e esta carga; não constituem uma classificação universal de plug-ins.

## Passos

1. Abra **Ajuda > CPU profiling**.
2. Inicie ou reinicie a reprodução depois de abrir o painel para que cada efeito em tempo real possa ser medido.
3. Observe várias actualizações. Compare as linhas dos efeitos com a linha do editor básico; ignore um efeito dispendioso e repita o mesmo trecho.
4. Feche o painel quando terminar e restaure o processamento que pretende manter.

## Verificar o resultado

A utilização da CPU pode exceder a capacidade de um único núcleo: 100% representa um núcleo da CPU totalmente ocupado. Compare as percentagens da CPU e do tempo de processamento decorrido. Um traço significa que não há uma medição disponível, não que o custo seja zero.

## Limites e recuperação

O tempo de processamento decorrido inclui atrasos de agendamento. A utilização da GPU e os processos auxiliares externos são excluídos, e a própria criação de perfis acrescenta sobrecarga. Um efeito ignorado é identificado separadamente. Abra **Mais opções > Auto-idle** no cabeçalho do efeito para permitir que um processador adequado suspenda durante o silêncio. Desactive-a nos efeitos que precisam de temporização contínua. Consulte [processamento local](/help/local-processing/) para definições relacionadas. Reproduza sempre o mesmo trecho ao comparar alterações.
