---
title: "播放时降低噪声"
description: "为对白音轨添加实时 AI 降噪效果。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"zh-CN"} -->

为对白音轨添加实时 AI 降噪效果。

## 开始之前

使用 Soundscaper 桌面版。打开 **工具 > 模型管理器**，安装当前版本提供的匹配实时降噪模型和运行时。安装模型需要明确下载；仅靠浏览器无法运行此原生效果。

## 步骤

1. 选择有噪声的对白音轨并打开其实时效果架。
2. 选择 **添加效果器**，然后选择 **AI denoising (DPDFNet2)**。
3. 开始播放，并使用电源按钮旁通效果以进行对比。
4. 调整已清理音轨周围的混音，并在交付前试听导出结果。保存项目以保留效果架。

## 检查结果

噪声应有所降低，同时语音仍清晰可辨。检查较轻的辅音、呼吸声和播放开头。如果听到抽吸感或语音缺失，请旁通效果并与原始音频对比。

## 限制和恢复

这是语音降噪功能，不是通用音乐修复效果。在其他电脑上播放需要兼容的模型和原生运行时。如果效果不可用，请检查安装和桌面端支持；如需经过审核的渲染结果，请使用[离线语音修复](/soundscaper/restore-damaged-speech/)。下载了模型并不代表每段录音都会变好。
