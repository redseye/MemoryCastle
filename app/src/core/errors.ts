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

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`找不到：${what}`);
    this.name = 'NotFoundError';
  }
}
