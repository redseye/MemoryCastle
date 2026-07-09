// Resolves a REST path's :id into a registered project and, from there, an
// open Castle. Centralized here so every route module shares the same
// project_not_found / no_castle behavior instead of re-deriving it.

import { readConfig } from '../config/index.js';
import type { ProjectRegistration, UserConfig } from '../config/index.js';
import { openCastle, type Castle } from '../core/index.js';
import { HttpError } from './http-errors.js';

export function findProjectSync(config: UserConfig, id: string): ProjectRegistration {
  const project = config.projects.find((p) => p.id === id);
  if (!project) throw new HttpError(404, 'project_not_found', `找不到已註冊的專案：${id}`);
  return project;
}

export async function findProject(id: string): Promise<ProjectRegistration> {
  const config = await readConfig();
  return findProjectSync(config, id);
}

// openCastle throws NoCastleError when the project's root has no castle
// scaffold yet; app.ts's onError maps that to 409 { code: "no_castle" }.
export async function openProjectCastle(id: string): Promise<Castle> {
  const project = await findProject(id);
  return openCastle(project.root);
}
