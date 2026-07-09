// Importer-local types (plan §8). ParsedCastle is the intermediate shape
// shared by importPreview (read-only) and importApply (writes it out via M1
// storage) so the two phases can never disagree about what was parsed.

import type { CastleRecord, ChronicleArchiveEntry, KeepSection, RouteDef } from '../core/types.js';

export interface ImportWarning {
  file: string; // relative to <project>/.claude/castle/, forward-slash
  line: number; // 1-based
  text: string; // the offending raw line
  reason: string;
}

export interface ImportCounts {
  keep: number;
  chronicle: number;
  routes: number;
  rooms: number;
  archiveMonths: number;
}

export interface ImportPreviewResult {
  counts: ImportCounts;
  warnings: ImportWarning[];
}

export interface ImportApplySummary {
  counts: ImportCounts;
  warnings: ImportWarning[];
  movedFiles: string[]; // relative to castleDir, forward-slash
}

export interface ParsedKeep {
  sections: Record<KeepSection, CastleRecord[]>;
  lastPatrolAt: string | null;
}

export interface ParsedRoom {
  slug: string;
  name: string;
  locus: string[];
  adjacent: string[];
  emblem: string | null;
  records: CastleRecord[];
}

export interface ParsedArchiveMonth {
  month: string; // YYYY-MM
  entries: ChronicleArchiveEntry[];
}

export interface ParsedCastle {
  keep: ParsedKeep;
  chronicle: CastleRecord[];
  routes: RouteDef[];
  rooms: ParsedRoom[];
  archiveMonths: ParsedArchiveMonth[];
  warnings: ImportWarning[];
  mdFiles: string[]; // every source .md file found, relative to castleDir
}
