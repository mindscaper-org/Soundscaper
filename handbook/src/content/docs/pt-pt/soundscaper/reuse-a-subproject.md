---
title: "Reutilizar um projecto guardado como áudio associado"
description: "Insira um projecto guardado noutro arranjo e acompanhe as edições posteriores."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"pt-PT"} -->

Insira um projecto guardado noutro arranjo e acompanhe as edições posteriores.

## Antes de começar

Guarde o projecto Soundscaper subordinado na mesma biblioteca local de projectos. Termine primeiro a mistura. Renderize e consolide o processamento de plug-ins nativos activos em áudio antes de utilizar o renderizador de subprojectos em segundo plano.

## Passos

1. Abra o projecto principal e escolha **Ficheiro > Subprojects**.
2. Escolha o subordinado em **Project to insert or relink** e, em seguida, **Insert subproject**. A mistura publicada aparece numa nova faixa.
3. Seleccione a ligação em **Linked subprojects** e escolha **Open subproject** para editar o subordinado. Guarde-o e regresse ao principal para ouvir o áudio actualizado.
4. Escolha **Pin current audio** para manter esta revisão ou **Make independent audio** para deixar de acompanhar o subordinado.

## Verificar o resultado

A colocação no projecto principal mantém-se quando o subordinado é actualizado. Reproduza o áudio depois da actualização e verifique o início e o fim. Uma mistura subordinada mais curta é preenchida com silêncio dentro do intervalo publicado original.

## Limites e recuperação

A duração publicada e a disposição dos canais permanecem fixas; insira outra colocação para utilizar um intervalo diferente. Um ficheiro portátil do projecto principal inclui o áudio instalado, mas não o projecto subordinado editável. Transfira o subordinado em separado e utilize **Relink to selected project**. As ligações cíclicas são recusadas.
