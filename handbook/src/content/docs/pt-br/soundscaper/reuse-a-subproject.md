---
title: "Reutilizar um projeto salvo como áudio vinculado"
description: "Insira um projeto salvo em outro arranjo e acompanhe as edições feitas nele depois."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"pt-BR"} -->

Insira um projeto salvo em outro arranjo e acompanhe as edições feitas nele depois.

## Antes de começar

Salve o projeto Soundscaper filho na mesma biblioteca local de projetos. Termine a mixagem primeiro. Renderize e consolide em áudio o processamento de plug-ins nativos ativos antes de usar o renderizador de subprojetos em segundo plano.

## Etapas

1. Abra o projeto pai e escolha **Arquivo > Subprojects**.
2. Escolha o filho em **Project to insert or relink** e depois **Insert subproject**. A mixagem publicada aparecerá em uma nova faixa.
3. Selecione o vínculo em **Linked subprojects** e escolha **Open subproject** para editar o filho. Salve-o e volte ao pai para ouvir o áudio atualizado.
4. Escolha **Pin current audio** para manter esta revisão ou **Make independent audio** para parar de acompanhar o filho.

## Verifique o resultado

A posição do pai permanece a mesma quando o filho é atualizado. Reproduza o áudio depois da atualização e verifique o início e o fim. Uma mixagem filha mais curta recebe silêncio até o limite publicado original.

## Limites e recuperação

A duração publicada e o layout de canais permanecem fixos; insira outra instância para usar um intervalo diferente. Um arquivo portátil do projeto pai inclui o áudio instalado, mas não o projeto filho editável. Transfira o filho separadamente e use **Relink to selected project**. Vínculos cíclicos são recusados.
