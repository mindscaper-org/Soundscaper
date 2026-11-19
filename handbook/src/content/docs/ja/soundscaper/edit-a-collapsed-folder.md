---
title: "折りたたんだフォルダー内のトラックを編集する"
description: "各トラックを展開せずに、折りたたんだフォルダー内のトラックをまたいでカットや挿入を行います。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd8133599ee12edc8c0a2f7e6a53c585f9fd13ede306c99a58ccfb4bb40f39c1","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd8133599ee12edc8c0a2f7e6a53c585f9fd13ede306c99a58ccfb4bb40f39c1","targetLocale":"ja"} -->

各トラックを展開せずに、折りたたんだフォルダー内のトラックをまたいでカットや挿入を行います。

## 始める前に

トラックの **トラックメニュー > 選択肢を新しいフォルダに移動** からトラックフォルダーを作るか、既存のフォルダー構成を開きます。一緒に移動する内容を含むフォルダーを確認します。

## 手順

1. 折りたたんだフォルダーを選び、**編集 > Edit folder contents > Select folder contents** を選びます。同じサブメニューはフォルダーのコンテキストメニューにもあります。
2. フォルダーの概要上で時間範囲をドラッグし、選択の開始位置と終了位置を確認します。
3. **Edit folder contents** から **Cut from folder and close gap** を選ぶと、範囲を削除し、後続素材をフォルダー内で前に移動します。
4. コピーした素材の挿入には **Insert clipboard into folder** を使い、操作を元に戻すには **取り消す** を使います。

## 結果を確認する

フォルダーを折りたたんだまま、子孫トラックに編集が反映されます。後で展開し、カットを確認して、フォルダー外の関係ないトラックがそのままかを確かめます。

## 制限と復旧

フォルダー編集の対象は子孫トラックであり、プロジェクト全体ではありません。フォルダー外の音楽や環境音と編集箇所を一緒に聞き、意図したタイミングの差を確認します。グループ編集の前にロック状態とフォルダーを確認し、大きな構造変更の前に[スナップショット](/soundscaper/save-session-snapshots/)を保存します。
