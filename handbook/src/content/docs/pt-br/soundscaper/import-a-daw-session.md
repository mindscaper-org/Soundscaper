---
title: "Importar uma sessão de áudio de outro editor"
description: "Importe edições de áudio compatíveis, reconecte as mídias e confira os limites da conversão."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"pt-BR"} -->

Importe edições de áudio compatíveis, reconecte as mídias e confira os limites da conversão.

## Antes de começar

Copie a sessão e seus arquivos de áudio para uma pasta acessível. Os formatos nativos de sessão de áudio compatíveis incluem REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, sessões do SoundCraft e Audition `.sesx` ou o antigo `.ses`. Mantenha o projeto original.

## Etapas

1. Escolha **Arquivo > Aberto** ou **Arquivo > Importação**, ou arraste a sessão para a área de trabalho.
2. No navegador, selecione o áudio correspondente junto com a sessão. No desktop, conceda acesso à pasta de mídia quando solicitado.
3. Abra **Arquivo > Relatório de entrega**. Leia as omissões e conversões e reconecte as mídias offline se necessário.
4. Ouça edições e fades representativos, inspecione a ordem e o tempo das faixas e salve um novo projeto Scape.

## Verifique o resultado

Os cortes importados devem coincidir com o áudio de origem acessível. Compare o resultado com uma mixagem de referência do editor original, especialmente quando processamento, roteamento ou automação forem importantes.

## Limites e recuperação

A importação nativa converte edições de áudio e não garante mixagens idênticas. Os detalhes compatíveis variam por formato; plug-ins da sessão de origem não são executados. O REAPER usa as tomadas de áudio ativas e omite a criação de tomadas alternativas, MIDI, roteamento e plug-ins. Para intercâmbio com outra DAW, use formatos compatíveis, como AES31 ADL ou DAWproject, em vez de esperar que uma sessão nativa seja criada.
