---
title: "破損した Audacity プロジェクトから音声を復旧する"
description: "破損したプロジェクトを評価し、復旧した内容を別のコピーとして保存します。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"ja"} -->

破損したプロジェクトを評価し、復旧した内容を別のコピーとして保存します。

## 始める前に

まず破損した Audacity プロジェクトのコピーを作成します。利用可能なサイドカーファイルも一緒に保管します。対応する `.aup3` と Audacity の未保存プロジェクトファイルは復旧できますが、失われたサンプルを再作成することはできません。

## 手順

1. **ファイル > プロジェクト管理 > Audacityプロジェクトを復旧** を開きます。
2. 破損したプロジェクトを選びます。インポートや保存をする前に **Recovery assessment** を読みます。
3. 影響箇所の追加ページも含めて **Missing audio ranges** を確認します。
4. 表示されている場合は **Save repaired Audacity copy** を選びます。それ以外の場合は、復旧結果を開いて互換性レポートを確認し、新しい名前で保存します。

## 結果を確認する

復旧した箇所を再生し、レポートに照らして欠落や無音を確認します。新しいコピーが開くことを確かめてから利用します。再度の復旧に備え、破損した元ファイルも保持します。

## 制限と復旧

復旧では、有効な音声の先頭部分を救出し、欠けたサンプルを無音に置き換えることがあります。データベースが修復されても、すべての音声が残ったり、すべてのネイティブ編集機能が移行したりするわけではありません。レポートの省略項目を読み、診断中に唯一の元ファイルを上書きしないでください。通常の破損していないプロジェクトには[Audacity の読み込みガイド](/guides/projects/open-an-audacity-project/)を使います。
