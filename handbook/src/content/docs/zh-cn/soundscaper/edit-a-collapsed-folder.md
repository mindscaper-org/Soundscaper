---
title: "在折叠的文件夹内编辑音轨"
description: "无需展开每条音轨，即可剪切或插入折叠文件夹中嵌套音轨的片段。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd8133599ee12edc8c0a2f7e6a53c585f9fd13ede306c99a58ccfb4bb40f39c1","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd8133599ee12edc8c0a2f7e6a53c585f9fd13ede306c99a58ccfb4bb40f39c1","targetLocale":"zh-CN"} -->

无需展开每条音轨，即可剪切或插入折叠文件夹中嵌套音轨的片段。

## 开始之前

在某条音轨上使用 **轨道菜单 > 将所选内容移入新文件夹** 创建音轨文件夹，或者打开现有文件夹编排。确定要让其中内容一起移动的文件夹。

## 步骤

1. 选择折叠的文件夹，然后选择 **编辑 > Edit folder contents > Select folder contents**。也可以从文件夹的上下文菜单打开同一子菜单。
2. 在文件夹概览中拖动一个时间范围，并检查选区的起点和终点。
3. 在 **Edit folder contents** 中选择 **Cut from folder and close gap**，移除该片段并移动文件夹内后续素材以关闭空隙。
4. 使用 **Insert clipboard into folder** 插入已复制的素材，或使用 **撤销** 撤销操作。

## 检查结果

文件夹保持折叠，子级音轨会应用编辑。之后展开文件夹检查剪切结果，并确认文件夹外不相关的音轨仍在原位。

## 限制和恢复

文件夹编辑仅作用于其子级，不会自动影响整个项目。将编辑片段与文件夹外的音乐或环境声一起试听，以发现有意保留的时间差。执行成组编辑前检查锁定状态和目标文件夹；进行较大的结构变更前保存[快照](/soundscaper/save-session-snapshots/)。
