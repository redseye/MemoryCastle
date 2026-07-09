import { useEffect, useState } from 'react';
import { getCliStatus, getSettings, putSettings, testSettings } from '../api';
import { ErrorBanner, Loading } from '../components/ErrorBanner';
import { useAsync } from '../hooks';
import { DEFAULT_MODELS } from '../types';
import type { LlmMode, LlmProviderId } from '../types';

type CliName = 'claude' | 'codex' | 'agy';
type CliStatus = Record<CliName, { found: boolean; version?: string }>;

// Which local CLI each provider shells out to in CLI mode.
const CLI_BY_PROVIDER: Record<LlmProviderId, CliName> = {
  anthropic: 'claude',
  gemini: 'agy',
  openai: 'codex',
};

export function SettingsPage() {
  const { data, loading, error, reload } = useAsync(() => getSettings(), []);

  const [provider, setProvider] = useState<LlmProviderId>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [port, setPort] = useState(7420);
  const [maskedApiKey, setMaskedApiKey] = useState('');
  const [mode, setMode] = useState<LlmMode>('api');

  const [cliStatus, setCliStatus] = useState<CliStatus | null>(null);
  const [cliStatusError, setCliStatusError] = useState<Error | null>(null);

  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [saved, setSaved] = useState(false);

  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [testError, setTestError] = useState<Error | null>(null);

  useEffect(() => {
    if (!data) return;
    setProvider(data.llm.provider);
    setModel(data.llm.model);
    setPort(data.port);
    setMaskedApiKey(data.llm.apiKey);
    setMode(data.llm.mode ?? 'api');
  }, [data]);

  // CLI detection is a local PATH/version check only (no login or quota
  // cost), so it's safe to run on every page load.
  useEffect(() => {
    loadCliStatus();
  }, []);

  async function loadCliStatus() {
    try {
      const status = await getCliStatus();
      setCliStatus(status);
      setCliStatusError(null);
    } catch (e) {
      setCliStatusError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  function handleProviderChange(next: LlmProviderId) {
    setProvider(next);
    // Model text input is pre-filled with the provider's default as a
    // display hint only, per plan — only overwrite if the field still holds
    // the previous provider's default (don't clobber a custom model name).
    if (!model || Object.values(DEFAULT_MODELS).includes(model)) {
      setModel(DEFAULT_MODELS[next]);
    }
  }

  function handleModeChange(next: LlmMode) {
    setMode(next);
    if (next === 'cli') {
      loadCliStatus();
    }
  }

  async function handleSave() {
    setSaveBusy(true);
    setSaveError(null);
    setSaved(false);
    try {
      await putSettings({
        port,
        llm: { provider, model, mode, ...(apiKey ? { apiKey } : {}) },
      });
      setApiKey('');
      setSaved(true);
      reload();
    } catch (e) {
      setSaveError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setSaveBusy(false);
    }
  }

  async function handleTest() {
    setTestBusy(true);
    setTestError(null);
    setTestResult(null);
    try {
      await testSettings();
      setTestResult('ok');
    } catch (e) {
      setTestResult('fail');
      setTestError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setTestBusy(false);
    }
  }

  return (
    <div>
      <h1>設定</h1>
      <p className="page-intro">LLM 供應商與 API Key 為使用者層級設定，不會進入專案或被 commit。</p>
      <ErrorBanner error={error} />
      {loading || !data ? (
        <Loading />
      ) : (
        <div className="panel">
          <div className="mode-toggle">
            <label className="mode-option">
              <input type="radio" name="llm-mode" checked={mode === 'api'} onChange={() => handleModeChange('api')} />
              API 模式（填 API key，預設）
            </label>
            <label className="mode-option">
              <input type="radio" name="llm-mode" checked={mode === 'cli'} onChange={() => handleModeChange('cli')} />
              CLI 模式（用本機已登入的官方 CLI 訂閱額度）
            </label>
          </div>

          <div className="form-grid">
            <label>
              LLM 供應商
              <select value={provider} onChange={(e) => handleProviderChange(e.target.value as LlmProviderId)}>
                <option value="anthropic">anthropic</option>
                <option value="gemini">gemini</option>
                <option value="openai">openai</option>
              </select>
            </label>
            <label>
              API Key（留空表示不變更）
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={mode === 'cli' ? 'CLI 模式下不使用此欄位' : maskedApiKey || '尚未設定'}
                disabled={mode === 'cli'}
              />
              {mode === 'cli' && <span className="card-meta">CLI 模式下會忽略此欄位，改由本機 CLI 的登入狀態提供額度。</span>}
            </label>
            <label>
              模型名稱
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder={DEFAULT_MODELS[provider]} />
            </label>
            <label>
              Port
              <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </label>
          </div>

          {mode === 'cli' && (
            <div className="cli-panel">
              <div className="banner banner-warning">
                未經官方正式支援的個人自用灰色地帶、延遲較高（每次呼叫啟動子行程）、額度與條款可能隨時變動。
              </div>
              <h3>CLI 偵測狀態</h3>
              <ErrorBanner error={cliStatusError} />
              {cliStatus && (
                <table>
                  <thead>
                    <tr>
                      <th>CLI</th>
                      <th>供應商</th>
                      <th>狀態</th>
                      <th>版本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Object.keys(CLI_BY_PROVIDER) as LlmProviderId[]).map((p) => {
                      const name = CLI_BY_PROVIDER[p];
                      const s = cliStatus[name];
                      const isSelected = provider === p;
                      return (
                        <tr key={name} style={isSelected ? { fontWeight: 600 } : undefined}>
                          <td>
                            {name}
                            {isSelected ? '（目前選用）' : ''}
                          </td>
                          <td>{p}</td>
                          <td>
                            <span className={`badge ${s.found ? 'badge-conf-high' : 'badge-conf-low'}`}>
                              {s.found ? '已偵測到' : '未偵測到'}
                            </span>
                          </td>
                          <td>{s.version ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <ErrorBanner error={saveError} />
          {saved && <div className="banner banner-success">設定已儲存。</div>}
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={saveBusy} onClick={handleSave}>
              儲存設定
            </button>
          </div>

          <h3 style={{ marginTop: '1.25rem' }}>測試連線</h3>
          <p className="card-meta">測試會驗證目前「已儲存」的設定，請先儲存再測試。</p>
          {testResult === 'ok' && <div className="banner banner-success">連線成功。</div>}
          {testResult === 'fail' && <ErrorBanner error={testError} />}
          <div className="btn-row">
            <button type="button" className="btn" disabled={testBusy} onClick={handleTest}>
              測試連線
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
