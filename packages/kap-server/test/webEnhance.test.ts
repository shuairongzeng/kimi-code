import { describe, expect, it } from 'vitest';

import { fuzzyScore, injectEnhanceScript, ZIMI_ENHANCE_SCRIPT } from '../src/routes/webEnhance';

describe('fuzzyScore', () => {
  it('matches case-insensitive subsequences', () => {
    expect(fuzzyScore('glm', 'zhipu/GLM-5.2')).not.toBeNull();
    expect(fuzzyScore('dsv4p', 'deepseek-v4-pro')).not.toBeNull();
    expect(fuzzyScore('GLM', 'zhipu/glm-5.2')).not.toBeNull();
    expect(fuzzyScore('k3', 'Kimi K3 高速')).not.toBeNull();
  });

  it('returns null for non-subsequences', () => {
    expect(fuzzyScore('xyz', 'glm-4')).toBeNull();
    expect(fuzzyScore('glm5', 'glm-4')).toBeNull();
  });

  it('scores empty needle as 0', () => {
    expect(fuzzyScore('', 'abc')).toBe(0);
    expect(fuzzyScore('', '')).toBe(0);
  });

  it('returns null when haystack is empty but needle is not', () => {
    expect(fuzzyScore('a', '')).toBeNull();
  });

  it('is symmetric across argument casing', () => {
    expect(fuzzyScore('DSV4P', 'DeepSeek-V4-Pro')).toStrictEqual(
      fuzzyScore('dsv4p', 'deepseek-v4-pro'),
    );
  });

  it('prefers word-start and early hits', () => {
    const contiguous = fuzzyScore('glm', 'glm-4.5');
    const scattered = fuzzyScore('glm', 'zhipu/glm');

    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous as number).toBeGreaterThan(scattered as number);
  });

  it('prefers prefixes over word-internal matches', () => {
    const prefix = fuzzyScore('glm', 'glm-zhipu');
    const internal = fuzzyScore('glm', 'zglm-zhipu');

    expect(prefix as number).toBeGreaterThan(internal as number);
  });

  it('is a pure self-contained function', () => {
    // No identifiers beyond its own arguments and locals may appear in its
    // source, because the source is serialized into the browser script.
    const source = String(fuzzyScore);
    expect(source).toMatch(/^function fuzzyScore\(/);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const isolated: typeof fuzzyScore = new Function(
      `return (${source});`,
    )() as typeof fuzzyScore;
    expect(isolated('glm', 'GLM-4')).not.toBeNull();
    expect(isolated('xyz', 'abc')).toBeNull();
    expect(isolated('k3', 'Kimi K3 高速')).not.toBeNull();
  });
});

describe('injectEnhanceScript', () => {
  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="UTF-8" />',
    '<title>Zimi</title>',
    '</head>',
    '<body><div id="root"></div></body>',
    '</html>',
  ].join('\n');

  it('inserts the script tag right before </head>', () => {
    const injected = injectEnhanceScript(html);

    expect(injected).toBe(
      html.replace(
        '</head>',
        '<script src="/zimi-enhance.js"></script></head>',
      ),
    );
  });

  it('is idempotent', () => {
    const once = injectEnhanceScript(html);
    const twice = injectEnhanceScript(once);

    expect(twice).toBe(once);
    expect(twice.match(/<script src="\/zimi-enhance\.js"><\/script>/g)).toHaveLength(1);
  });

  it('is case-insensitive about </head>', () => {
    const injected = injectEnhanceScript('<head></HEAD><body></body>');

    expect(injected).toBe('<head><script src="/zimi-enhance.js"></script></HEAD><body></body>');
  });

  it('returns fragments without </head> unchanged', () => {
    const fragment = '<main>Zimi</main>';

    expect(injectEnhanceScript(fragment)).toBe(fragment);
  });

  it('returns html that already references the script unchanged', () => {
    const preexisting =
      '<head><script src="/zimi-enhance.js"></script></head><body></body>';

    expect(injectEnhanceScript(preexisting)).toBe(preexisting);
  });
});

describe('ZIMI_ENHANCE_SCRIPT', () => {
  it('is syntactically valid standalone JavaScript', () => {
    expect(() => new Function(ZIMI_ENHANCE_SCRIPT)).not.toThrow();
  });

  it('embeds the fuzzyScore implementation and the hidden class', () => {
    expect(ZIMI_ENHANCE_SCRIPT).toContain('fuzzyScore');
    expect(ZIMI_ENHANCE_SCRIPT).toContain('zimi-enhance-hidden');
  });

  it('is wrapped in an IIFE', () => {
    expect(ZIMI_ENHANCE_SCRIPT).toMatch(/\(\s*\(\)\s*=>\s*\{/);
  });

  it('embeds the exact exported fuzzyScore source', () => {
    expect(ZIMI_ENHANCE_SCRIPT).toContain(`const fuzzyScore = ${String(fuzzyScore)};`);
  });

  it('keeps the embedded fuzzyScore behavior identical to the export', () => {
    const prefix = 'const fuzzyScore = ';
    const start = ZIMI_ENHANCE_SCRIPT.indexOf(prefix);
    expect(start).toBeGreaterThanOrEqual(0);
    const iifeStart = ZIMI_ENHANCE_SCRIPT.indexOf('(() => {');
    expect(iifeStart).toBeGreaterThan(start + prefix.length);

    // `const fuzzyScore = <function source>;` is the full statement before the
    // IIFE; the trailing ';' is stripped so the source stays a valid expression.
    const statement = ZIMI_ENHANCE_SCRIPT.slice(start, iifeStart).trim();
    const source = statement.slice(prefix.length, -1);
    const embedded: typeof fuzzyScore = new Function(
      `return (${source});`,
    )() as typeof fuzzyScore;

    for (const [needle, haystack] of [
      ['glm', 'GLM-4'],
      ['xyz', 'abc'],
      ['dsv4p', 'deepseek-v4-pro'],
      ['', 'abc'],
    ] as const) {
      expect(embedded(needle, haystack)).toStrictEqual(fuzzyScore(needle, haystack));
    }
  });
});
