---
title: "MIDI を楽器で再生する"
description: "MIDI ノート用のシンセサイザーを選び、編集可能な演奏を保ちます。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"ja"} -->

MIDI ノート用のシンセサイザーを選び、編集可能な演奏を保ちます。

## 始める前に

MIDI を開くか読み込むか、Soundscaper で新しいトラックを作成します。内蔵の再生方法と、任意で使えるネイティブ楽器は異なります。ネイティブプラグイン楽器にはデスクトップアプリと、対応して有効になっているプラグインが必要です。

## 手順

1. トラックが必要なら **トラックメニュー > 新しいトラックを追加 > MIDI track (beta)** を選びます。
2. **ウィンドウ > Piano roll (beta)** を開きます。ノートを追加するか、既存の MIDI 素材を選択します。
3. **Instrument** を選びます。ネイティブ楽器では **Instrument settings** を開いて音を調整し、プリセットを保存します。
4. 再生してノートとサステインを確認し、プロジェクトを保存して開き直します。

## 結果を確認する

選択した楽器の音が聞こえ、ピアノロールのノートは編集可能なままです。必要なプラグインがインストールされていれば、開き直したときに楽器設定とプリセットが戻ります。

## 制限と復旧

ネイティブ楽器は通常のオーディオトラックではなく MIDI トラックで使います。保存したプリセットにプラグインのバイナリや外部ライブラリは含まれません。対応デスクトップパッケージでは同梱楽器が既定で有効です。それ以外の楽器には [Plugin Manager](/soundscaper/use-desktop-plugins/) が必要な場合があります。同じ音色に依存する前に、出力先のコンピューターで再生と書き出しを確認してください。
