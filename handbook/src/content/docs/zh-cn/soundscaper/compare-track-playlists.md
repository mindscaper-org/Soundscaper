---
title: "比较同一音轨上的不同编辑版本"
description: "为同一音轨保留多个编排版本并在它们之间切换。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"8c79a03859a4d9d2082884e1a7ea71d11b90b021b834a5e4699f7a01b7a3b029","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8c79a03859a4d9d2082884e1a7ea71d11b90b021b834a5e4699f7a01b7a3b029","targetLocale":"zh-CN"} -->

为同一音轨保留多个编排版本并在它们之间切换。

## 开始之前

在可写的 Soundscaper 项目中选择要编辑的音轨。播放列表会切换该音轨的素材；要保留完整编排，请使用[会话快照](/soundscaper/save-session-snapshots/)。

## 步骤

1. 打开 **音轨 > Track playlists**。
2. 输入 **Playlist name**，然后选择 **Duplicate current playlist**。在时间线上编辑当前副本。如果需要空白版本，请改选 **Create empty playlist**。
3. 重新打开对话框，在 **Playlists** 下选择 **原始**，然后选择 **Activate playlist** 以试听先前的编辑。
4. 激活另一个版本进行比较。完成后可使用 **Rename playlist**，或删除非活动播放列表。

## 检查结果

该音轨只显示当前活动的播放列表。**撤销** 会撤销切换。等待项目保存后重新打开，并确认两个命名版本仍然可用。

## 限制和恢复

不能删除活动播放列表。非活动版本仍会引用其音频并占用存储空间。播放列表是同一音轨上的备选版本，不会同时作为多个声部播放；要同时听到两者，请将素材放在不同音轨上。
