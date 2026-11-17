---
title: "1 つのトラックで別の編集を比較する"
description: "同じトラックに複数のアレンジを保持して切り替えます。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"8c79a03859a4d9d2082884e1a7ea71d11b90b021b834a5e4699f7a01b7a3b029","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8c79a03859a4d9d2082884e1a7ea71d11b90b021b834a5e4699f7a01b7a3b029","targetLocale":"ja"} -->

同じトラックに複数のアレンジを保持して切り替えます。

## 始める前に

書き込み可能な Soundscaper プロジェクトで編集するオーディオトラックを選択します。プレイリストはそのトラックの素材を切り替えます。アレンジ全体を保存するには[セッションスナップショット](/soundscaper/save-session-snapshots/)を使います。

## 手順

1. **トラックメニュー > Track playlists** を開きます。
2. **Playlist name** を入力し、**Duplicate current playlist** を選びます。このアクティブなコピーをタイムラインで編集します。空のバージョンが必要な場合は **Create empty playlist** を選びます。
3. ダイアログを開き直し、**Playlists** の **オリジナル** を選んで **Activate playlist** を選び、以前の編集を聞きます。
4. 別のバージョンをアクティブにして比較します。完了したら **Rename playlist** を使うか、非アクティブなプレイリストを削除します。

## 結果を確認する

そのトラックにはアクティブなプレイリストだけが表示されます。**取り消す** で切り替えを取り消せます。プロジェクトの保存を待ってから開き直し、名前を付けた両方のバージョンが残っていることを確認します。

## 制限と復旧

アクティブなプレイリストは削除できません。非アクティブなバージョンも参照する音声を保持するため、ストレージを使用します。プレイリストは1つのトラックでの別案であり、同時に再生するレイヤーではありません。両方を同時に聞くには、素材を別々のトラックに置きます。
