---
title: "將錄製的音符轉換成可編輯 MIDI"
description: "使用 Basic Pitch 分析音樂錄音，並在音訊旁保留可編輯的音符。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"zh-TW"} -->

使用 Basic Pitch 分析音樂錄音，並在音訊旁保留可編輯的音符。

## 開始之前

在 Soundscaper 桌面版中安裝已發佈的 Basic Pitch 模型及相符的執行環境。從一小段音高清楚的音樂開始，並保留音訊作為聆聽參考。

## 步驟

1. 選取音樂音訊並開啟 **工具 > 進階本地處理**。
2. 將 **作業** 設為 **Audio to MIDI (Basic Pitch)**。確認所需的本機處理同意事項，再選擇 **分析**。
3. 選擇 **審閱結果**，檢查偵測到的音符，準備好後選擇 **接受建議**。
4. 開啟 **視窗 > Piano roll (beta)**，選取新的 MIDI 素材，並修正音高、時間和音符長度。

## 檢查結果

新的 MIDI 音軌會出現在原始音訊旁。選擇樂器並搭配錄音聆聽。**復原** 會移除已接受的提案，但不會刪除來源音訊。

## 限制與復原

偵測到的音符是估計值，尤其在密集混音或有噪音的錄音中更是如此。MIDI 記錄音符，而不是原始音色。使用 [MIDI 樂器](/soundscaper/play-midi-instruments/)播放，並使用 **檔案 > 匯出其他 > Export MIDI (beta)** 分享音符。接收者仍需要能重現預期聲音的樂器。
