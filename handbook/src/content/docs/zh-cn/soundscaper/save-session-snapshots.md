---
title: "保存和还原会话快照"
description: "尝试其他编辑前，先保存一个命名的编排版本。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","targetLocale":"zh-CN"} -->

尝试其他编辑前，先保存一个命名的编排版本。

## 开始之前

打开一个可写的 Soundscaper 项目，其中包含要保留的音频。快照属于此项目；另请保存一个便携式项目文件作为独立备份。

## 步骤

1. 打开 **文件 > Session snapshots**。
2. 输入 **Snapshot name**，例如“剪切对白前”，然后选择 **Create snapshot**。关闭对话框并开始编辑。
3. 要返回该版本，请重新打开对话框，在 **Saved snapshots** 下选中它，然后选择 **Restore snapshot**。
4. 使用 **Rename snapshot** 修改版本名称，或使用 **Delete snapshot** 删除不再需要的版本。

## 检查结果

先前的编排及其保留的音频会恢复。关闭对话框并播放恢复后的片段。**撤销** 会撤销恢复操作；**重做** 会再次恢复。

## 限制和恢复

快照是命名的项目状态，不是外部备份。它可能保留当前编排中已移除的音频，因此会占用存储空间。删除快照不会更改当前编排。参阅[项目备份](/projects-and-data/storage-backups-and-privacy/)。
