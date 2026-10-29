import { ApiError } from './api';

// Maps error envelope codes (src/server/app.ts onError) to friendly zh-TW
// copy. Falls back to the server's own message for anything unlisted.
const CODE_MESSAGES: Record<string, string> = {
  llm_not_configured: '尚未設定 LLM，請至「設定」頁面填入 API Key',
  invalid_api_key: 'API Key 無效，請至「設定」頁面重新確認',
  llm_bad_output: 'LLM 回應格式錯誤，請稍後再試一次',
  confirm_required: '此操作需要確認',
  no_castle: '此專案尚無城堡，請先建立',
  castle_exists: '城堡已存在，無法重複建立或匯入',
  project_not_found: '找不到已註冊的專案',
  not_found: '找不到資料',
  invalid_body: '請求格式錯誤',
  invalid_json: '請求格式錯誤',
  root_not_found: '找不到該目錄',
  route_not_found: '找不到路線',
  patrol_cancelled: '巡查已取消',
  patrol_already_running: '此專案已有巡查正在執行中，請稍候再試',
  patrol_not_running: '目前沒有正在執行的巡查工作',
};

export function describeError(error: Error | null): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    return CODE_MESSAGES[error.code] ?? error.message;
  }
  return error.message;
}
