// fuzzyRecallFlow: recall?fuzzy=true (plan §4/§5). Deterministic locus
// matching (locus.ts) is always run first by the route; this flow adds
// semantic room selection on top, for paths/activities the mechanical
// matcher missed or left ambiguous.

import type { Castle } from '../core/castle.js';
import type { RoomFile } from '../core/types.js';
import type { LlmService } from '../server/llm-seam.js';
import { FUZZY_ROOM_SELECT_SCHEMA } from '../llm/schemas.js';
import { fuzzyRoomSelectPrompt } from '../llm/prompts.js';

interface FuzzyRoomSelect {
  roomSlugs: string[];
  reason: string;
}

export async function fuzzyRecallFlow(castle: Castle, llmService: LlmService, paths: string[]): Promise<RoomFile[]> {
  const allRooms = await castle.rooms.list();
  if (allRooms.length === 0) return [];

  const result = await llmService.judge<FuzzyRoomSelect>({
    ...fuzzyRoomSelectPrompt({
      paths,
      rooms: allRooms.map((r) => ({ slug: r.slug, name: r.name, locus: r.locus, adjacent: r.adjacent })),
    }),
    schema: FUZZY_ROOM_SELECT_SCHEMA,
  });

  const bySlug = new Map(allRooms.map((r) => [r.slug, r]));
  return result.roomSlugs.map((slug) => bySlug.get(slug)).filter((r): r is RoomFile => r !== undefined);
}
