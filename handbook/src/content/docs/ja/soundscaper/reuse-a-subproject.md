---
title: "保存したプロジェクトをリンク音声として再利用する"
description: "保存済みプロジェクトを別のアレンジに挿入し、後からの編集を反映します。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"ja"} -->

保存済みプロジェクトを別のアレンジに挿入し、後からの編集を反映します。

## 始める前に

子 Soundscaper プロジェクトを同じローカルプロジェクトライブラリに保存します。先にミックスを完成させます。バックグラウンドのサブプロジェクトレンダラーを使う前に、アクティブなネイティブプラグイン処理をレンダリングして音声に反映します。

## 手順

1. 親プロジェクトを開き、**ファイル > Subprojects** を選びます。
2. **Project to insert or relink** で子プロジェクトを選び、**Insert subproject** を選びます。公開済みのミックスが新しいトラックに表示されます。
3. **Linked subprojects** のリンクを選び、**Open subproject** で子プロジェクトを編集します。保存したら親プロジェクトに戻り、更新された音声を聞きます。
4. この版を固定するには **Pin current audio** を、子プロジェクトへの追従を止めるには **Make independent audio** を選びます。

## 結果を確認する

子プロジェクトを更新しても、親側の配置はそのままです。更新後に再生し、先頭と末尾を確認します。子のミックスが短い場合、元の公開範囲内が無音で埋められます。

## 制限と復旧

公開済みの長さとチャンネル構成は固定です。別の範囲を使うには、別の配置を挿入します。ポータブルな親ファイルにはインストール済み音声が含まれますが、編集可能な子プロジェクトは含まれません。子を別途転送し、**Relink to selected project** を使います。循環するリンクは拒否されます。
