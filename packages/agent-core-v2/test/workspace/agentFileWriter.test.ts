import { describe, expect, it } from 'vitest';

import { AgentFileParseError, parseAgentFileText } from '#/workspace/workspaceAgentProfileLoader/internal/agentFile';
import { writeAgentFileText } from '#/workspace/workspaceAgentProfileLoader/internal/agentFileWriter';
import type { AgentFileDefinition } from '#/workspace/workspaceAgentProfileLoader/internal/types';

const SOURCE: AgentFileSource = 'user';
type AgentFileSource = 'user';

function roundtrip(
  input: Parameters<typeof writeAgentFileText>[0],
): AgentFileDefinition {
  const text = writeAgentFileText(input);
  return parseAgentFileText({
    path: `/tmp/agents/${input.name}.md`,
    source: SOURCE,
    text,
  });
}

describe('writeAgentFileText', () => {
  it('round-trips a full definition with tools and a Chinese prompt', () => {
    const parsed = roundtrip({
      name: 'code-reviewer',
      description: '严格的代码审查 agent',
      whenToUse: '代码评审、PR 检查',
      tools: ['Read', 'Grep', 'mcp__github__*'],
      disallowedTools: ['Bash'],
      subagents: ['explore', 'plan'],
      prompt: '你是严格的代码审查者。\n逐条给出结论。',
    });

    expect(parsed.name).toBe('code-reviewer');
    expect(parsed.description).toBe('严格的代码审查 agent');
    expect(parsed.whenToUse).toBe('代码评审、PR 检查');
    expect(parsed.override).toBe(false);
    expect(parsed.tools).toEqual(['Read', 'Grep', 'mcp__github__*']);
    expect(parsed.disallowedTools).toEqual(['Bash']);
    expect(parsed.subagents).toEqual(['explore', 'plan']);
    expect(parsed.prompt).toBe('你是严格的代码审查者。\n逐条给出结论。');
  });

  it('round-trips a description containing colons and quotes', () => {
    const parsed = roundtrip({
      name: 'qa-writer',
      description: 'colon: separated "quoted" text: with both',
      prompt: 'body',
    });

    expect(parsed.description).toBe('colon: separated "quoted" text: with both');
  });

  it('omits optional keys when undefined and keeps them undefined after parse', () => {
    const text = writeAgentFileText({
      name: 'solo',
      description: 'plain description',
      prompt: 'body text',
    });

    expect(text).not.toContain('whenToUse');
    expect(text).not.toContain('tools');
    expect(text).not.toContain('disallowedTools');
    expect(text).not.toContain('subagents');
    expect(text).not.toContain('override');

    const parsed = roundtrip({
      name: 'solo',
      description: 'plain description',
      prompt: 'body text',
    });
    expect(parsed.whenToUse).toBeUndefined();
    expect(parsed.tools).toBeUndefined();
    expect(parsed.disallowedTools).toBeUndefined();
    expect(parsed.subagents).toBeUndefined();
    expect(parsed.override).toBe(false);
  });

  it('writes override only when true', () => {
    const withTrue = writeAgentFileText({
      name: 'over',
      description: 'd',
      override: true,
      prompt: 'body',
    });
    expect(withTrue).toContain('override: true');

    const withFalse = writeAgentFileText({
      name: 'not-over',
      description: 'd',
      override: false,
      prompt: 'body',
    });
    expect(withFalse).not.toContain('override');
  });

  it('writes tools as a YAML list', () => {
    const text = writeAgentFileText({
      name: 'tool-limited',
      description: 'd',
      tools: ['Read', 'Grep'],
      prompt: 'body',
    });

    expect(text).toContain('tools:\n  - Read\n  - Grep');
  });

  it('produces output the parser accepts for multiline prompts', () => {
    const prompt = 'line one\n\nline two: with colon\n"quoted" line';
    const parsed = roundtrip({
      name: 'multiline',
      description: 'd',
      prompt,
    });
    expect(parsed.prompt).toBe(prompt);
  });

  it('emits a frontmatter block with a non-empty body', () => {
    const text = writeAgentFileText({
      name: 'shape',
      description: 'd',
      prompt: '  padded body  ',
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('---');
    expect(lines[1]).toBe('name: shape');
    expect(text.trimEnd().endsWith('padded body')).toBe(true);
    expect(() =>
      parseAgentFileText({ path: '/tmp/agents/shape.md', source: SOURCE, text }),
    ).not.toThrow();
    expect(AgentFileParseError.name).toBe('AgentFileParseError');
  });
});
