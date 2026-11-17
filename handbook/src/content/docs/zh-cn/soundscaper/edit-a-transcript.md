---
title: "通过转录文本剪切语音"
description: "选择带时间信息的转录词语，以定位并编辑对应音频。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","targetLocale":"zh-CN"} -->

选择带时间信息的转录词语，以定位并编辑对应音频。

## 开始之前

打开包含语音的项目。生成新转录需要使用桌面应用、已安装且兼容的本地模型，并明确征得你的同意。已有带时间信息的转录可以直接使用，无需重新生成。

## 步骤

1. 打开 **编辑 > Transcript-based editing**。
2. 如果有 **Generate transcript** 选项，请选择它并按照模型和权限提示操作。等待音轨处理完成。
3. 单击一个词以跳转到对应音频。双击该词以选中它，然后检查时间线上高亮的范围。
4. 焦点位于转录面板时，按 **Backspace** 或 **删除** 删除所选词语及其关联音频。试听剪辑连接处，必要时使用 **撤销**。

## 检查结果

转录和音频会一起编辑，选中片段会显示出来，但缩放级别不会改变。保存、关闭并重新打开面板，即可继续处理保留的转录。

## 限制和恢复

语音识别和词语时间可能有误：删除前先试听。Web 编辑器会说明转录生成仅限桌面端，而不会下载或运行模型。转录只是编辑辅助工具，不保证逐字准确。大量剪切对白前请保存[快照](/soundscaper/save-session-snapshots/)。
