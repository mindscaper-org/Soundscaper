---
title: "Encontrar efeitos que consomem CPU na reprodução"
description: "Compare os custos dos efeitos em tempo real antes de decidir qual processamento simplificar."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"pt-BR"} -->

Compare os custos dos efeitos em tempo real antes de decidir qual processamento simplificar.

## Antes de começar

Use um projeto com efeitos em tempo real e um trecho representativo com bastante atividade. As medições descrevem este dispositivo e esta carga; não constituem um ranking universal de plug-ins.

## Etapas

1. Abra **Ajuda > CPU profiling**.
2. Inicie ou reinicie a reprodução depois de abrir o painel para medir cada efeito em tempo real.
3. Observe várias atualizações. Compare as linhas dos efeitos à linha do editor básico; ignore um efeito caro e repita o mesmo trecho.
4. Feche o painel ao terminar e restaure o processamento que deseja manter.

## Verifique o resultado

O uso da CPU pode exceder a capacidade de um único núcleo: 100% representa um núcleo totalmente ocupado. Compare os percentuais de CPU e de tempo de processamento decorrido. Um traço significa que não há medição disponível, não que o custo seja zero.

## Limites e recuperação

O tempo de processamento decorrido inclui atrasos de agendamento. O uso da GPU e os processos auxiliares externos ficam de fora, e a própria criação do perfil adiciona uma sobrecarga. Um efeito ignorado é identificado separadamente. Abra **Mais opções > Auto-idle** no cabeçalho de um efeito para permitir que um processador adequado entre em repouso durante o silêncio. Desative-o em efeitos que exigem temporização contínua. Consulte [processamento local](/help/local-processing/) para ver configurações relacionadas. Sempre reproduza o mesmo trecho ao comparar alterações.
