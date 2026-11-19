---
title: "将已保存项目作为链接音频重复使用"
description: "将已保存项目插入其他编排，并跟随其后续编辑。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"zh-CN"} -->

将已保存项目插入其他编排，并跟随其后续编辑。

## 开始之前

将子 Soundscaper 项目保存在同一个本地项目库中。先完成混音。在使用后台子项目渲染器之前，将已启用的原生插件处理渲染并提交到音频中。

## 步骤

1. 打开父项目并选择 **文件 > Subprojects**。
2. 在 **Project to insert or relink** 下选择子项目，然后选择 **Insert subproject**。其已发布的混音会出现在新音轨上。
3. 选择 **Linked subprojects** 下的链接，再选择 **Open subproject** 编辑子项目。保存后返回父项目以试听更新的音频。
4. 选择 **Pin current audio** 保留此版本，或选择 **Make independent audio** 停止跟随子项目。

## 检查结果

子项目更新时，父项目中的放置位置保持不变。刷新后播放并检查开头和结尾。较短的子项目混音会在原始发布范围内补上静音。

## 限制和恢复

已发布的时长和声道布局固定不变；要使用其他范围，请另插入一个实例。便携式父项目文件包含已安装的音频，但不包含可编辑的子项目。请单独传输子项目并使用 **Relink to selected project**。系统会拒绝循环链接。
