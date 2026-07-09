# Routes — MemoryCastle

> 固定順序的巡行路線，各綁一個時機。巡行必須按順序走完每一站、讀每站指定的內容，結尾必報：「巡行 N/N 房，發現 X 項注意」。跳站＝無效巡行，重走。
> 權限：增刪既有路線的站點＝綠級（附 read-back）；新增或刪除整條路線＝黃級（時機屬於使用者的工作流）。

## route: session-start — 每個 session 開工時走

1. keep.md — 全文讀（不超過 30 行）
2. 本次 session 要動的檔案／活動所屬的房間（還沒有房間——房間由巡查誕生，不預先蓋）

## route: before-release — 使用者說 release／deploy／publish／上線／對外發布 時走

1. keep.md — 約束區（本專案的出貨擋門磚：不用 hook 規則、視同團隊公開規則）
<!-- 每當有房間出現 ⚠before-release 行，就把它加成一站；巡查第 7 步（routes 檢查）會抓漏 -->

## route: patrol — 巡查觸發時走（architecture §4）

1. chronicle.md — 把未整理的記錄按 locus 聚類
2. 所有房間，固定順序：（還沒有）
3. keep.md — 預算檢查（修改屬黃級）；更新標頭的巡查日期
4. routes.md — 第 2 站列了所有房間嗎？每個 ⚠ 標記指的路線都存在嗎？補漏（綠級，附 read-back）
