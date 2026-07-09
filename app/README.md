# MemoryCastle App

A local, single-user web tool + REST API for operating a project's
[MemoryCastle](../docs/architecture.md) memory: a Web UI to browse and edit
keep/chronicle/rooms/routes, and an HTTP API any agent (Claude Code, Gemini
CLI, Codex, ...) can call directly. Runs entirely on `127.0.0.1` — no data
leaves your machine except calls you configure to an LLM provider.

**Relationship to the methodology**: MemoryCastle itself is a file-based
memory methodology (`docs/architecture.md`, `skill/SKILL.md`) that a host
model executes by reading markdown instructions — no required runtime. This
`app/` directory is that methodology's v0.4 milestone (`docs/architecture.md`
§9 roadmap: "SDK (TypeScript)"): the same record/keep/chronicle/room/route
model, reimplemented as a deterministic engine plus an optional LLM adapter
for gate/patrol judgment, with JSON storage instead of markdown. A project
can use either the pure-markdown method or this app against the same
`.claude/castle/` layout (via the one-time importer); it does not replace or
require the methodology.

## Quickstart

```bash
npm install
npm run build:all      # tsc (API) + vite build (Web UI -> dist/public)
node dist/cli.js serve # single port: UI at /, API at /api/v1
```

Open `http://127.0.0.1:7420/` (or whatever port is printed), register your
first project's root directory from the Dashboard page (on Windows, the
「瀏覽…」 button next to the path field opens a native folder picker instead
of typing the path by hand), then either:

- **New project**: click init to scaffold `.claude/castle/` JSON files, or
- **Existing markdown castle** (`.claude/castle/*.md`): use the Import page
  to preview then apply a one-time markdown -> JSON conversion (originals are
  moved to `archive/markdown-original/`, not deleted).

Then open Settings to pick an LLM provider (Anthropic / Gemini / OpenAI) and
paste an API key if you want the admission-gate (`remember`) and patrol
proposal features — everything else (browsing, editing, walking routes,
patrol's deterministic warnings) works with no key configured at all.

Settings also offers a **CLI mode** that reuses an existing subscription by
shelling out to a locally-installed, already-logged-in official CLI
(`claude` / `codex` / `agy`) instead of an API key. This is a personal-use
grey zone with no official third-party endorsement and materially higher
per-call latency (a subprocess starts every time) — **API mode is the
default and recommended path**; see `docs/api.md`'s Settings section before
switching.

Agents should read `docs/api.md` instead of this file — it documents every
`/api/v1` endpoint with request/response shapes and curl examples.

## Development

```bash
npm run web:dev        # Vite dev server (proxies /api/* to the API process)
node dist/cli.js serve # run the API separately, after an `npm run build`
npm test                # vitest — unit + e2e, no build required
```

`npm run web:dev` only starts the frontend; run the API from a build in a
second terminal so the Vite proxy has something to talk to.

## 桌面版（Electron）

MemoryCastle 也提供 Windows 桌面版：Electron 主程序直接 in-process 載入既有的
build 產物（`dist/`），在同一個連接埠上開同一顆伺服器，外面包一個原生視窗——
`memorycastle serve`（CLI）完全不受影響，桌面版只是多一種啟動方式。

### 開發模式

```bash
npm run electron:dev   # build:all + 編譯 electron 主程序，然後直接開視窗（未打包）
```

視窗標題「MemoryCastle」，指向 CLI 平常會服務的同一個
`http://127.0.0.1:<port>/`（埠號讀 `~/.memorycastle/config.json`，預設 7420）。
啟動時會先探測該埠：

- 若已有 MemoryCastle 伺服器在回應（例如你已經在另一個終端機跑
  `node dist/cli.js serve`）——**附掛**：只開視窗，關閉視窗時不會動到那顆伺服器。
- 若該埠是空的——**自己啟動**一顆 in-process 伺服器，關閉視窗時一併關閉。
- 若該埠被別的程式占用（回應不是 MemoryCastle 的健康檢查）——跳出錯誤對話框並
  結束，不會硬猜或搶埠。

### 打包成 portable 單檔 .exe

```bash
npm run dist:electron   # build:all + 編譯 electron 主程序，然後 electron-builder --win portable
```

產出 `app/release/MemoryCastle-<version>-portable.exe`——單一檔案、無安裝程序、
不寫登錄檔，雙擊即可執行。

- **首次執行 / SmartScreen**：此 exe 未簽章，Windows SmartScreen 會顯示「未識別
  的應用程式」警告，點「其他資訊」→「仍要執行」即可，這是預期行為（未購買
  code-signing 憑證）。
- **啟動延遲**：portable exe 每次執行都會先解壓縮到暫存目錄，因此第一個視窗跳
  出來會比 `electron:dev`（未打包）慢個幾秒。
- 圖示：目前用 Electron 預設圖示，尚未做客製化 .ico。

### 已知的相依套件 bug（環境紀錄）

打包當下遇到兩個上游套件的 ESM/CJS 相容性 bug，皆與本專案程式碼無關：

- `electron@43.0.0` 的 `install.js` 用 `require()` 讀取它自己宣告的
  `@electron/get@^5.0.0`，但該版本已改成純 ESM，導致全新安裝的
  `node_modules/electron` 抓不到真正的執行檔（`npx electron` 會直接噴
  `ERR_REQUIRE_ESM`）。之後若重新 `npm install` 遇到同樣狀況，須手動下載對應
  平台的 release zip（`https://github.com/electron/electron/releases/download/v<版本>/electron-v<版本>-win32-x64.zip`）解壓進
  `node_modules/electron/dist/`，並在 `node_modules/electron/path.txt` 寫入
  `electron.exe`。
- `electron-builder@26.15.x` 的 `app-builder-lib` 新增了對 `@noble/hashes@^2.2.0`
  的直接依賴（做 blockmap 用的 blake2 雜湊），該版本也是純 ESM，用
  `require()` 會炸。因此 `package.json` 把 `electron-builder` 釘死在
  `26.13.0`——這是最後一個尚未引入該相依的版本，`dist:electron` 已用這個版本
  驗證可正常打包。

## Configuration

User-level config lives at `~/.memorycastle/config.json` (created on first
write, with defaults if missing or partial):

```json
{
  "schema": 1,
  "port": 7420,
  "llm": { "provider": "anthropic", "apiKey": "", "model": "claude-sonnet-5", "mode": "api" },
  "projects": [{ "id": "my-app", "name": "My App", "root": "C:/path/to/my-app" }]
}
```

- `port` — default port for `memorycastle serve`.
- `llm` — the configured provider/key/model; edit via the Settings page or
  `PUT /settings`, never by hand-pasting a raw key into a shared file.
  `mode` is `"api"` (default) or `"cli"` — see the CLI mode note under
  Quickstart and `docs/api.md`.
- `projects` — registrations (id/name/root), managed via the Dashboard page
  or `POST`/`DELETE /projects`. Unregistering never touches the project's
  castle on disk.

### Overrides

| Variable | Effect |
|---|---|
| `MEMORYCASTLE_PORT` | Overrides the configured port for this launch only |
| `MEMORYCASTLE_CONFIG` | Overrides the config file path (used by the test suite; also useful for running multiple isolated instances) |
| `--port <n>` (CLI flag on `serve`) | Same as `MEMORYCASTLE_PORT`, takes precedence over the config file |

Each project's own data (`keep.json`, `chronicle.json`, `rooms/`,
`routes.json`, `archive/`) lives in that project's own
`<project>/.claude/castle/` — nothing project-specific is stored under
`~/.memorycastle/`.
