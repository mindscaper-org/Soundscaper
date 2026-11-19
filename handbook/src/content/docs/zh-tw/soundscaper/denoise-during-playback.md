---
title: "播放時降低噪音"
description: "為對白音軌加入即時 AI 降噪效果。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"zh-TW"} -->

為對白音軌加入即時 AI 降噪效果。

## 開始之前

使用 Soundscaper 桌面版。開啟 **工具 > 模型管理器**，安裝目前版本提供的相容即時降噪模型和執行環境。安裝模型需要明確下載；單靠瀏覽器無法執行這項原生效果。

## 步驟

1. 選取有噪音的對白音軌並開啟即時效果架。
2. 選擇 **加入效果器**，再選取 **AI denoising (DPDFNet2)**。
3. 開始播放，並使用電源按鈕略過效果來比較。
4. 調整已清理音軌周圍的混音，交付前試聽匯出結果。儲存專案以保留效果架。

## 檢查結果

噪音應降低，同時語音仍清晰可辨。檢查較輕的子音、呼吸聲和播放開頭。如果聽到音量抽動或語音缺失，請略過效果並與原始音訊比較。

## 限制與復原

這是語音降噪功能，不是一般音樂修復效果。在其他電腦上播放需要相容的模型和原生執行環境。如果沒有這項效果，請檢查安裝情況和桌面版支援；如需經審核的算繪結果，請使用[離線語音修復](/soundscaper/restore-damaged-speech/)。下載模型不代表每段錄音都會改善。
