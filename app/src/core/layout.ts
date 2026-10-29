// Castle directory layout: <project>/.claude/castle/... (plan §2).

import { join } from 'node:path';

export function castleDirOf(root: string): string {
  return join(root, '.claude', 'castle');
}

export function castleJsonPath(castleDir: string): string {
  return join(castleDir, 'castle.json');
}

export function keepJsonPath(castleDir: string): string {
  return join(castleDir, 'keep.json');
}

export function chronicleJsonPath(castleDir: string): string {
  return join(castleDir, 'chronicle.json');
}

export function routesJsonPath(castleDir: string): string {
  return join(castleDir, 'routes.json');
}

export function roomsDirPath(castleDir: string): string {
  return join(castleDir, 'rooms');
}

export function roomJsonPath(castleDir: string, slug: string): string {
  return join(roomsDirPath(castleDir), `${slug}.json`);
}

export function archiveDirPath(castleDir: string): string {
  return join(castleDir, 'archive');
}

export function archiveChroniclePath(castleDir: string, month: string): string {
  return join(archiveDirPath(castleDir), `chronicle-${month}.json`);
}

export function archivedRoomRecordsPath(castleDir: string, month: string): string {
  return join(archiveDirPath(castleDir), `room-records-${month}.json`);
}
