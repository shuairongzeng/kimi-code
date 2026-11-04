import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// 1) gather candidate text files (tracked, non-binary)
const files = execSync('git ls-files', {encoding:'utf8'}).split('\n').filter(Boolean)
  .filter(f => !f.includes('dist-web/'))
  .filter(f => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|json|jsonl|md|markdown|txt|vue|yml|yaml|toml|html|css|scss|sh|bash|ps1|py|snap|svg|xml|editorconfig|gitignore|gitattributes|npmrc|nvmrc|vscodeignore|Dockerfile|Makefile|flake\.nix|lock|cfg|conf|properties)$/.test(f) || /(^|\/)(Dockerfile|Makefile|LICENSE|CHANGELOG[^/]*)$/.test(f) || /^\.github\//.test(f) || f === 'AGENTS.md' || f === 'CLAUDE.md');

const SKIP_FILES = new Set(['LICENSE']);
const BINARY_EXT = /\.(png|jpg|jpeg|gif|webp|ico|zip|exe|dll|woff2?|ttf|otf|eot|mp4|mov|pdf|node)$/;

function preserveCase(src, dst) {
  if (src === src.toUpperCase()) return dst.toUpperCase();      // KIMI -> ZIMI
  if (src[0] === src[0].toUpperCase()) return dst[0].toUpperCase() + dst.slice(1); // Kimi -> Zimi
  return dst;                                                    // kimi -> zimi
}

// ordered replacements: longest first to avoid partial overlaps
const rules = [
  // scope
  [/@moonshot-ai/g, '@zimi-ai'],
  // org / repo / docs sites
  [/github\.com\/MoonshotAI\//g, 'github.com/ZimiAI/'],
  [/moonshotai\.github\.io\//g, 'zimia.github.io/'],
  // protected: keep API hosts & model ids BEFORE generic token rewrite
  // (handled below via placeholder)
];

// strings to keep verbatim (API endpoints, model ids, install hosts)
const PROTECT = [
  /https?:\/\/[^\s"'`)\]]+/g,           // all URLs — protected as a unit
  /\bkimi-k[A-Za-z0-9._-]*/g,           // model ids
  /\bkimi-for-coding[A-Za-z0-9._-]*/g,  // model ids
  /\bkimi-k[A-Za-z0-9._-]*/gi,          // (dup, harmless)
];

let stats = {files: 0, urls: 0, models: 0};

for (const f of files) {
  if (SKIP_FILES.has(f) || BINARY_EXT.test(f)) continue;
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  if (!/kimi|Kimi|KIMI|moonshot|Moonshot/i.test(text)) continue;

  const kept = [];
  // protect URLs and model ids
  text = text.replace(/https?:\/\/[^\s"'`)\]}<>]+/g, (m) => {
    kept.push(m); stats.urls++;
    return `\x00${kept.length - 1}\x00`;
  });
  text = text.replace(/\bkimi-k[A-Za-z0-9._-]*\b|\bkimi-for-coding\b/g, (m) => {
    kept.push(m); stats.models++;
    return `\x00${kept.length - 1}\x00`;
  });

  // generic token rewrite (preserving case)
  text = text
    .replace(/kimi-code|Kimi-code/g, (m) => preserveCase(m, 'zimi-code'))
    .replace(/KimiCode/g, 'ZimiCode')
    .replace(/KIMI_CODE/g, 'ZIMI_CODE')
    .replace(/kimiCode/g, 'zimiCode')
    .replace(/kimi_code/g, 'zimi_code')
    .replace(/kimi-code/g, 'zimi-code')
    .replace(/kimi/g, 'zimi')
    .replace(/Kimi/g, 'Zimi')
    .replace(/KIMI/g, 'ZIMI')
    // scope (must run after kimi rewrite? no — scope has no 'kimi')
  ;
  // scope rewrite (after URL protection: scoped names are not URLs)
  text = text
    .replace(/@moonshot-ai\//g, '@zimi-ai/')
    .replace(/moonshot-ai/g, 'zimi-ai')
    .replace(/MoonshotAI/g, 'ZimiAI')
    .replace(/Moonshot\b/g, 'Zimi')
    .replace(/moonshotai/g, 'zimia')
    .replace(/moonshotai/g, (m) => preserveCase(m, 'zimia'))
    .replace(/moonshot/g, 'zimi');

  // restore protected strings
  text = text.replace(/\x00(\d+)\x00/g, (m, i) => kept[+i]);

  writeFileSync(f, text);
  stats.files++;
}
console.log(JSON.stringify(stats));
