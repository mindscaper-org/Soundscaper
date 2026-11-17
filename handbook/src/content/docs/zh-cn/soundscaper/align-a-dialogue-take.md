---
title: "对齐替换的对白录音"
description: "让同一句台词的第二次表演贴合参考片段。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","targetLocale":"zh-CN"} -->

让同一句台词的第二次表演贴合参考片段。

## 开始之前

准备两个已解锁的单声道或立体声音频片段，每段时长为 0.25–30 秒。两段应包含相同的台词，表达方式也应大致相似。先渲染或取消链接与视频关联或锚定到节拍的素材。

## 步骤

1. 打开 **编辑 > 音频片段 > Align dialogue**。
2. 明确选择参考和替换片段，然后设置对齐强度。
3. 选择 **Analyze and align**。比较 **Play reference**、**Play replacement** 和 **Play aligned**。仔细听辅音和呼吸声。
4. 只有在结果听起来合适后，才选择 **Create aligned copy**。

## 检查结果

新音轨会在参考片段的起点和时长处包含对齐后的副本。原始片段仍可使用。**撤销** 可一步删除创建的副本。保存并重新打开项目，即可继续使用已渲染的结果，而无需再次分析。

## 限制和恢复

替换片段的时长必须介于参考片段时长的一半至两倍之间。对齐基于声学分析，不会查看唇形或验证文字稿。台词不同、背景噪声或多人说话重叠都可能导致失败。如果分析无法匹配，请改用更短且台词相同的短语，或手动编辑。更改输入或强度后必须重新分析。
