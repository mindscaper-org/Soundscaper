---
title: "從損毀的 Audacity 專案復原音訊"
description: "評估損毀的專案，並將復原內容儲存為另一份副本。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"zh-TW"} -->

評估損毀的專案，並將復原內容儲存為另一份副本。

## 開始之前

先複製損毀的 Audacity 專案。將可用的側邊檔案放在一起。復原功能可處理支援的 `.aup3` 和 Audacity 未儲存專案檔，但無法重新建立已不存在的取樣資料。

## 步驟

1. 開啟 **檔案 > 專案管理 > 恢復 Audacity 專案**。
2. 選取損毀的專案。在匯入或儲存任何內容前，閱讀 **Recovery assessment**。
3. 檢查 **Missing audio ranges**，包括受影響位置的其他頁面。
4. 如果有 **Save repaired Audacity copy**，請選擇它。否則開啟復原結果，檢閱相容性報告，再以新名稱儲存。

## 檢查結果

播放復原的片段，並依照報告檢查空白或靜音。確認新副本可以開啟後再依賴它。保留原始損毀檔案，以便再次嘗試復原。

## 限制與復原

復原可能救回有效的音訊前段，並以靜音取代遺失的取樣資料。資料庫修復完成，不代表所有音訊都已保留，或每項原生編輯功能都能轉移。閱讀報告中省略的項目，診斷時絕不要覆寫唯一的原始檔。一般完整專案請使用 [Audacity 匯入指南](/guides/projects/open-an-audacity-project/)。
