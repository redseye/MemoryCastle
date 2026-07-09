# Chronicle — MemoryCastle

> 只增不改的情節日誌。一行一事；舊行永不修改。累積 20 條未整理時，由固化巡查掃入 archive/chronicle-YYYY-MM.md（見 architecture §4）。
> 每次寫入前先過城門（§3）：新穎（repo／git 查不到）＋會複用（未來 session 需要）＋一行可驗證且附原因。永不寫入：機密、token、第三方個資。
> Session 交接格式：`- [日期 | conf:high | src:session] 狀態：X／決定：Y／下一步：Z #handover`
> 記錄一律繁體中文；格式骨架與 tag 照舊。

- [2026-07-05 | conf:high | src:castle-init] 城堡初始化完成（MemoryCastle）。#meta
- [2026-07-06 | conf:high | src:user] 創始四決策：方法論先行、SDK 後行；第一宿主＝Claude Code 原生；技術棧＝v0.1 用 Markdown＋零依賴 Node、SDK 階段用 TypeScript；里程碑一＝設計文件＋骨架＋最小可運作實例。#decision
- [2026-07-06 | conf:high | src:session] 核心差異化選擇「准入閘勝過全存」——實測的問題是記憶信不信得過，不是找不找得到（architecture §8）。#decision
- [2026-07-06 | conf:high | src:session] 最小可運作實例選擇自舉：最便宜的真實示範，並強迫框架吃自己的狗糧。#decision
- [2026-07-06 | conf:high | src:session] castle-init.mjs 原以 toISOString 蓋 UTC 日期戳；已改用 toLocaleDateString('sv') 取本地日期——台灣（UTC+8）在午夜前後會標錯日。#lesson
- [2026-07-06 | conf:high | src:session] 狀態：里程碑一檔案全落地（架構、三模板、skill、init 腳本、自舉實例）／決定：見上方 #decision／下一步：README，然後 verifier 驗收。#handover
- [2026-07-06 | conf:high | src:castle-verify] 里程碑一由獨立 verifier 驗收 6/6 通過（檔案完整、實例嚴格通過 §2 格式、預算跨五檔一致、init 腳本跨 UTC 日界實測、第一步測試通過）。發現並修復一個缺口：SKILL.md 補齊 conf 三級定義。#milestone
- [2026-07-06 | conf:high | src:session] 狀態：v0.1 完成並驗收／決定：無待決事項／下一步：使用者擇一——真實專案 dogfood 或先審 architecture.md。#handover
- [2026-07-06 | conf:high | src:user] 使用者定調願景：原型是真正的記憶宮殿法（空間檢索當主角）；記憶屬於專案；執行靠模型自律；v0.1 要解的信任問題仍然要解。#decision
- [2026-07-06 | conf:high | src:user] v0.2 空間版核准並出貨：房間從主題改錨定到 locus（地點歸屬可機械判定）；新增 routes 作為完整性保證（巡行必報 N/N）；adjacent／emblem 行；v0.1 信任機制原封保留。#decision #milestone
- [2026-07-06 | conf:high | src:session] 狀態：v0.2 檔案全落地（架構、room/routes/keep 模板、skill、init 腳本、本實例）／決定：見上方 #decision／下一步：verifier 驗收，然後使用者挑第一個 dogfood 專案。#handover
- [2026-07-06 | conf:high | src:castle-verify-v02] v0.2 驗收 6/7；唯一 FAIL 是流程真抓到的矛盾：路線圖改號後 keep.md 仍寫「automation opt-in v0.2」——已改為不綁版本號的寫法（a later version, architecture §9）。次要：實例 before-release 觸發詞對齊 skill 的超集。矛盾解決規則（§4.3）如設計運作。#milestone #lesson
- [2026-07-06 | conf:high | src:session] 狀態：v0.2 完成、驗收過、矛盾已解／決定：無待決事項／下一步：使用者挑第一個 dogfood 專案（複製 skill/ 到 ~/.claude/skills/castle/、對真實專案跑 castle-init）。#handover
- [2026-07-06 | conf:high | src:user] castle skill 已安裝到 ~\.claude\skills\castle\，全域可用；各專案只剩 init＋決定城堡要不要進版控兩步。#meta
- [2026-07-06 | conf:high | src:user] 使用者指示：castle 記錄內文全程使用繁體中文。既有英文記錄已翻譯為繁中；英文原文完整保存於 archive\chronicle-2026-07-en-original.md。#decision
- [2026-07-06 | conf:high | src:user] 使用者加碼指示：不只記錄行，生成的城堡檔案（keep／chronicle／routes／rooms）整份繁體中文——記憶宮殿是給人看的。模板、實例、腳本訊息全面改版；只有結構識別鍵（locus:、路線名、格式骨架、tag）保持英文。#decision
