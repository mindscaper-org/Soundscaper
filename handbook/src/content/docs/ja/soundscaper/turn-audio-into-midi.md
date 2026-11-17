---
title: "録音した音を編集可能な MIDI に変換する"
description: "Basic Pitch で音楽録音を解析し、音声と並べて編集可能なノートを作成します。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"ja"} -->

Basic Pitch で音楽録音を解析し、音声と並べて編集可能なノートを作成します。

## 始める前に

Soundscaper デスクトップ版に、公開済みの Basic Pitch モデルと対応ランタイムをインストールします。音程が明確な短い音楽範囲から始めます。音声は試聴用の基準として残します。

## 手順

1. 音楽音声を選択し、**ツール > 高度なローカル処理** を開きます。
2. **操作** を **Audio to MIDI (Basic Pitch)** に設定します。必要なローカル処理の同意を確認し、**分析** を選びます。
3. **結果の確認** を選び、検出されたノートを確認して、準備ができたら **提案を受け入れる** を選びます。
4. **ウィンドウ > Piano roll (beta)** を開き、新しい MIDI 素材を選択して音高、タイミング、ノートの長さを修正します。

## 結果を確認する

元の音声に並んで新しい MIDI トラックが表示されます。楽器を選び、録音と一緒に聞きます。**取り消す** で提案を削除できますが、音声ソースは削除されません。

## 制限と復旧

検出されたノートは推定値であり、特に密度の高いミックスやノイズのある録音では不正確なことがあります。MIDI が記録するのはノートであり、元の音色ではありません。再生には[MIDI 楽器](/soundscaper/play-midi-instruments/)を使い、共有には **ファイル > その他の書き出し > Export MIDI (beta)** を使います。受け取る側も、意図した音を再現できる楽器が必要です。
