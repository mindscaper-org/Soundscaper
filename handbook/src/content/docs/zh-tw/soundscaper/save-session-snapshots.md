---
title: "儲存及還原工作階段快照"
description: "嘗試其他編輯前，先儲存一個命名的編排版本。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","targetLocale":"zh-TW"} -->

嘗試其他編輯前，先儲存一個命名的編排版本。

## 開始之前

開啟可寫入且包含要保留音訊的 Soundscaper 專案。快照屬於這個專案；另外也請儲存可攜式專案檔作為獨立備份。

## 步驟

1. 開啟 **檔案 > Session snapshots**。
2. 輸入 **Snapshot name**，例如「剪輯對白之前」，然後選擇 **Create snapshot**。關閉對話框並開始編輯。
3. 若要回到該版本，重新開啟對話框，在 **Saved snapshots** 下選取快照，再選擇 **Restore snapshot**。
4. 使用 **Rename snapshot** 讓版本名稱更清楚，或使用 **Delete snapshot** 刪除不再需要的版本。

## 檢查結果

較早的編排及其保留的音訊會恢復。關閉對話框並播放還原的片段。**復原** 會復原還原動作；**重做** 會再次還原。

## 限制與復原

快照是命名的專案狀態，不是外部備份。它可能保留目前編排中已移除的音訊，因此會佔用儲存空間。刪除快照不會改變目前的編排。請參閱[專案備份](/projects-and-data/storage-backups-and-privacy/)。
