---
title: "Importar uma sessão de áudio de outro editor"
description: "Importe edições de áudio suportadas, volte a ligar os suportes e consulte os limites da conversão."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"pt-PT"} -->

Importe edições de áudio suportadas, volte a ligar os suportes e consulte os limites da conversão.

## Antes de começar

Copie a sessão e o respectivo áudio para uma pasta acessível. As importações de sessões de áudio nativas suportadas incluem REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, sessões SoundCraft e Audition `.sesx` ou o formato legado `.ses`. Conserve o projecto original.

## Passos

1. Escolha **Ficheiro > Aberto** ou **Ficheiro > Importação**, ou largue a sessão na área de trabalho.
2. Num navegador, seleccione o áudio associado com a sessão. Na versão para computador, conceda acesso à pasta dos suportes quando solicitado.
3. Abra **Ficheiro > Relatório de entrega**. Consulte as omissões e conversões e volte a ligar os suportes offline, se necessário.
4. Ouça edições e fades representativos, inspeccione a ordem e a temporização das faixas e guarde um novo projecto Scape.

## Verificar o resultado

Os cortes importados deverão coincidir com o áudio de origem acessível. Compare o resultado com uma mistura de referência do editor original, sobretudo quando o processamento, o encaminhamento ou a automatização forem importantes.

## Limites e recuperação

A importação nativa converte edições de áudio, mas não garante misturas idênticas. Os detalhes suportados variam consoante o formato; os plug-ins da sessão de origem não são executados. O REAPER utiliza as tomadas de áudio activas e omite a criação de tomadas alternativas, MIDI, encaminhamento e plug-ins. Para trocar dados com outra DAW, utilize formatos de intercâmbio suportados, como AES31 ADL ou DAWproject, em vez de esperar que seja criado um ficheiro de sessão nativo.
