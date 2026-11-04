import type { SkillDefinition } from '#/features/skill/catalog/types';
import { parseSkillText } from '#/features/skill/catalog/parser';
import CHECK_ZIMI_CODE_DOCS_BODY from './check-zimi-code-docs.md?raw';

const PSEUDO_PATH = 'builtin://check-zimi-code-docs';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/check-zimi-code-docs.md',
  skillDirName: 'check-zimi-code-docs',
  source: 'builtin',
  text: CHECK_ZIMI_CODE_DOCS_BODY,
});

export const CHECK_ZIMI_CODE_DOCS_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
  productSpecific: true,
};
