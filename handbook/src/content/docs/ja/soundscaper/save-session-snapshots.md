---
title: "セッションスナップショットを保存、復元する"
description: "別の編集を試す前に、名前を付けたアレンジのバージョンを保存します。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","targetLocale":"ja"} -->

別の編集を試す前に、名前を付けたアレンジのバージョンを保存します。

## 始める前に

残したい音声が含まれる、書き込み可能な Soundscaper プロジェクトを開きます。スナップショットはこのプロジェクトに属します。別のバックアップとして、ポータブルプロジェクトファイルも保存してください。

## 手順

1. **ファイル > Session snapshots** を開きます。
2. 「セリフをカットする前」などの **Snapshot name** を入力し、**Create snapshot** を選びます。ダイアログを閉じて編集します。
3. このバージョンに戻すには、ダイアログを開き直し、**Saved snapshots** からスナップショットを選んで **Restore snapshot** を選びます。
4. **Rename snapshot** でバージョン名を分かりやすくしたり、不要になったものを **Delete snapshot** で削除したりできます。

## 結果を確認する

以前のアレンジと保持されていた音声が戻ります。ダイアログを閉じ、復元した箇所を再生します。**取り消す** で復元を取り消し、**やり直す** で再び復元できます。

## 制限と復旧

スナップショットは名前付きのプロジェクト状態であり、外部バックアップではありません。現在のアレンジから削除した音声も保持することがあり、その分ストレージを使用します。スナップショットを削除しても現在のアレンジは変わりません。[プロジェクトのバックアップ](/projects-and-data/storage-backups-and-privacy/)を参照してください。
