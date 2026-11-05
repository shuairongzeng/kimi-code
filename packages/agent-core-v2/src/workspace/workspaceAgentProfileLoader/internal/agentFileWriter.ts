import { dump as dumpYaml } from 'js-yaml';

export interface AgentFileWriterInput {
  readonly name: string;
  readonly description: string;
  readonly whenToUse?: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly override?: boolean;
  readonly tools?: readonly string[];
  readonly disallowedTools?: readonly string[];
  readonly subagents?: readonly string[];
  readonly prompt: string;
}

const LIST_FIELDS = ['tools', 'disallowedTools', 'subagents'] as const;

export function writeAgentFileText(definition: AgentFileWriterInput): string {
  const frontmatter: Record<string, string | boolean | readonly string[]> = {
    name: definition.name,
    description: definition.description,
  };
  if (definition.whenToUse !== undefined && definition.whenToUse.trim() !== '') {
    frontmatter['whenToUse'] = definition.whenToUse;
  }
  if (definition.model !== undefined && definition.model.trim() !== '') {
    frontmatter['model'] = definition.model;
  }
  if (definition.thinking !== undefined && definition.thinking.trim() !== '') {
    frontmatter['thinking'] = definition.thinking;
  }
  if (definition.override === true) {
    frontmatter['override'] = true;
  }
  for (const field of LIST_FIELDS) {
    const raw = definition[field];
    if (raw === undefined) continue;
    const filtered = raw.filter((value) => value.trim() !== '');
    if (filtered.length === 0) continue;
    if (!filtered.every((value) => !value.includes('\n'))) continue;
    frontmatter[field] = [...filtered];
  }
  const yaml = dumpYaml(frontmatter, {
    lineWidth: -1,
    noArrayIndent: false,
  }).trimEnd();
  const prompt = definition.prompt.trim();
  return `---\n${yaml}\n---\n\n${prompt}\n`;
}
