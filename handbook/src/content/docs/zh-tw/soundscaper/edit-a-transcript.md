---
title: "透過逐字稿剪輯語音"
description: "選取具有時間資訊的逐字稿文字，以定位並編輯對應音訊。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","targetLocale":"zh-TW"} -->

選取具有時間資訊的逐字稿文字，以定位並編輯對應音訊。

## 開始之前

開啟包含語音的專案。產生新逐字稿需要桌面應用程式、已安裝且相容的本機模型，以及你的明確同意。現有的定時逐字稿可直接使用，不必重新產生。

## 步驟

1. 開啟 **編輯 > Transcript-based editing**。
2. 若有 **Generate transcript**，請選取並依照模型和權限提示操作。等待音訊軌處理完成。
3. 按一下文字即可移至對應音訊。按兩下文字可選取它，再檢查時間軸上反白的範圍。
4. 當焦點位於逐字稿中時，按 **Backspace** 或 **刪除** 即可刪除選取的文字及其相關音訊。聆聽接點，必要時使用 **復原**。

## 檢查結果

逐字稿和音訊會一起編輯，選取的片段也會顯示出來，不會改變縮放比例。儲存、關閉並重新開啟面板，即可繼續使用保留的逐字稿。

## 限制與復原

語音辨識和文字時間可能不正確：刪除前請先聆聽。網頁版編輯器會說明逐字稿產生僅限桌面版，不會下載或執行模型。逐字稿是編輯輔助工具，不保證逐字完全正確。大量剪輯對白前請先儲存[快照](/soundscaper/save-session-snapshots/)。
