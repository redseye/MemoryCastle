export class CastleExistsError extends Error {
  constructor(castleDir: string) {
    super(`此處已有城堡：${castleDir} —— 拒絕覆蓋。確定要重建請自行刪除舊城堡。`);
    this.name = 'CastleExistsError';
  }
}

export class NoCastleError extends Error {
  constructor(castleDir: string) {
    super(`此處尚無城堡：${castleDir} —— 請先執行 init。`);
    this.name = 'NoCastleError';
  }
}

// The newest handover never leaves the chronicle: chronicle/last-handover
// reads it (architecture §4 step 4).
export class SweepRefusedError extends Error {
  constructor(id: string) {
    super(`拒絕封存：${id} 是最新一筆交接，須留在編年史供 chronicle/last-handover 讀取。`);
    this.name = 'SweepRefusedError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`找不到：${what}`);
    this.name = 'NotFoundError';
  }
}
