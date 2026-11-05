/**
 * Server-side enhancement for the frozen zimi web UI bundle.
 *
 * The "add/edit provider" dialog renders hundreds of model rows with no way to
 * search them. The frontend is a prebuilt React bundle (no sources), so a small
 * script is injected into index.html instead (see {@link ZIMI_ENHANCE_SCRIPT});
 * the main session serves it at /zimi-enhance.js.
 *
 * The enhancement is purely visual: model-row inputs are never written to and
 * no input/change events are dispatched into React-controlled controls.
 */

/**
 * Case-insensitive subsequence match.
 *
 * Every character of `needle` must appear in `haystack` in order; returns a
 * score (higher = better match) or null when `needle` is not a subsequence.
 * Empty needle scores 0 (matches everything).
 *
 * Scoring: per-character base score, bonus for consecutive hits, bonus for
 * word-start hits (string start or right after `- _ / . space`), and earlier
 * hits weigh more via a decaying position weight.
 *
 * Pure and self-contained: MUST NOT reference any module-scope identifier —
 * its source is serialized into the browser script via `toString()`.
 */
export function fuzzyScore(needle: string, haystack: string): number | null {
  const needleLower = needle.toLowerCase();
  const haystackLower = haystack.toLowerCase();
  const needleLen = needleLower.length;
  const haystackLen = haystackLower.length;
  if (needleLen === 0) {
    return 0;
  }
  let score = 0;
  let matched = 0;
  let prevMatchedIndex = -2;
  let lastIndex = -1;
  for (let i = 0; i < haystackLen; i++) {
    if (haystackLower.charAt(i) !== needleLower.charAt(matched)) {
      continue;
    }
    let charScore = 8;
    if (i === prevMatchedIndex + 1) {
      charScore += 4;
    }
    const prev = haystackLower.charAt(i - 1);
    if (i === 0 || prev === '-' || prev === '_' || prev === '/' || prev === '.' || prev === ' ') {
      charScore += 6;
    }
    score += charScore * (1 - i / (haystackLen + 1));
    prevMatchedIndex = i;
    lastIndex = i;
    matched++;
    if (matched === needleLen) {
      break;
    }
  }
  if (matched < needleLen) {
    return null;
  }
  return score + (1 - lastIndex / (haystackLen + 1)) * 8;
}

const ENHANCE_SCRIPT_TAG = '<script src="/zimi-enhance.js"></script>';

/**
 * Inject the enhancement script tag right before `</head>`.
 *
 * Idempotent (html already referencing the script is returned as-is) and safe
 * on fragments without `</head>`.
 */
export function injectEnhanceScript(html: string): string {
  if (html.includes('/zimi-enhance.js')) {
    return html;
  }
  const headClose = /<\/head>/i.exec(html);
  if (headClose === null) {
    return html;
  }
  return html.slice(0, headClose.index) + ENHANCE_SCRIPT_TAG + html.slice(headClose.index);
}

/**
 * Browser script injected into the zimi web UI (served at /zimi-enhance.js).
 *
 * Adds a sticky fuzzy-filter box above the model rows of a visible provider
 * dialog. ES2020 IIFE, no imports/exports; the embedded fuzzyScore is the
 * exact runtime source of the exported function (single implementation).
 */
export const ZIMI_ENHANCE_SCRIPT = `
const fuzzyScore = ${fuzzyScore.toString()};
(() => {
  'use strict';
  const LOADED_FLAG = '__zimiEnhanceLoaded';
  const FILTER_BAR_ID = '__zimiEnhanceFilterBar';
  const HIDDEN_CLASS = 'zimi-enhance-hidden';
  const REMOVE_MODEL_TEXTS = ['移除模型', 'Remove model'];
  const ENGLISH_UI =
    String((typeof navigator !== 'undefined' && navigator.language) || '')
      .toLowerCase()
      .indexOf('en') === 0;
  // Survives React re-rendering the bar away: the query is restored on rebuild.
  // Only ever applied to the script-owned filter input, never to React inputs.
  let lastQuery = '';

  function countText(matched, total) {
    return ENGLISH_UI
      ? 'Matched ' + matched + ' / ' + total
      : '匹配 ' + matched + ' / 共 ' + total;
  }

  function isRemoveModelButton(node) {
    if (!(node instanceof Element)) {
      return false;
    }
    if (node.tagName !== 'BUTTON' && node.getAttribute('role') !== 'button') {
      return false;
    }
    const ariaLabel = node.getAttribute('aria-label');
    const label = (ariaLabel !== null ? ariaLabel : node.textContent || '').trim();
    return REMOVE_MODEL_TEXTS.some((t) => label.indexOf(t) !== -1);
  }

  // A model row = nearest ancestor of a remove-model button holding >= 2 inputs.
  function findModelRow(button) {
    let current = button.parentElement;
    while (current !== null) {
      if (current.querySelectorAll('input').length >= 2) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function findModelRows() {
    const rows = [];
    const seen = new Set();
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const button of buttons) {
      if (!isRemoveModelButton(button)) {
        continue;
      }
      const row = findModelRow(button);
      if (row === null || seen.has(row)) {
        continue;
      }
      seen.add(row);
      rows.push(row);
    }
    return rows;
  }

  // The dialog container carries 'ui-dialog'; 'ui-dialog__overlay' is the mask.
  function findVisibleDialog(rows) {
    for (const row of rows) {
      let current = row.parentElement;
      while (current !== null) {
        const cls = typeof current.className === 'string' ? current.className : '';
        const isDialog =
          cls.indexOf('ui-dialog') !== -1 && cls.indexOf('ui-dialog__overlay') === -1;
        if (isDialog && current.getBoundingClientRect().height > 0) {
          return current;
        }
        current = current.parentElement;
      }
    }
    return null;
  }

  // Model id input value + display-name (last) input value.
  function collectRowText(row) {
    const inputs = row.querySelectorAll('input');
    if (inputs.length === 0) {
      return '';
    }
    const values = [inputs[0].value];
    if (inputs.length > 1) {
      values.push(inputs[inputs.length - 1].value);
    }
    return values.join(' ');
  }

  function removeFilterBar() {
    const bar = document.getElementById(FILTER_BAR_ID);
    if (bar !== null && bar.parentElement !== null) {
      bar.parentElement.removeChild(bar);
    }
  }

  function applyFilter() {
    const bar = document.getElementById(FILTER_BAR_ID);
    if (bar === null) {
      return;
    }
    const rows = findModelRows();
    const input = bar.querySelector('input');
    const count = bar.querySelector('span');
    if (rows.length === 0 || input === null || count === null) {
      return;
    }
    const query = String(input.value).trim();
    lastQuery = query;
    let matched = rows.length;
    if (query !== '') {
      matched = 0;
      for (const row of rows) {
        if (fuzzyScore(query, collectRowText(row)) === null) {
          row.classList.add(HIDDEN_CLASS);
        } else {
          row.classList.remove(HIDDEN_CLASS);
          matched++;
        }
      }
    } else {
      for (const row of rows) {
        row.classList.remove(HIDDEN_CLASS);
      }
    }
    // Guarded: unconditional textContent writes would re-trigger the observer.
    const next = countText(matched, rows.length);
    if (count.textContent !== next) {
      count.textContent = next;
    }
  }

  // The provider form contains zero-height template rows; anchor the bar to
  // the first row that is actually laid out, otherwise it lands in a hidden
  // container and renders at 0×0.
  function firstVisibleRow(rows) {
    for (const row of rows) {
      if (row.getBoundingClientRect().height > 0) {
        return row;
      }
    }
    return null;
  }

  function buildFilterBar(rows) {
    const anchor = firstVisibleRow(rows);
    if (anchor === null) {
      return null;
    }
    const container = anchor.parentElement;
    const existing = document.getElementById(FILTER_BAR_ID);
    if (existing !== null) {
      if (existing.parentElement === container) {
        return existing;
      }
      removeFilterBar();
    }
    const bar = document.createElement('div');
    bar.id = FILTER_BAR_ID;
    const input = document.createElement('input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.placeholder = ENGLISH_UI ? 'Filter models…' : '筛选模型…';
    input.value = lastQuery;
    const count = document.createElement('span');
    bar.appendChild(input);
    bar.appendChild(count);
    container.insertBefore(bar, anchor);
    input.addEventListener('input', () => {
      try {
        applyFilter();
      } catch (error) {
        // Silent: never break the host page.
      }
    });
    return bar;
  }

  function ensureFilterBar() {
    const rows = findModelRows();
    if (rows.length < 2 || findVisibleDialog(rows) === null) {
      removeFilterBar();
      return;
    }
    if (buildFilterBar(rows) === null) {
      return;
    }
    applyFilter();
  }

  function init() {
    if (document.body === null) {
      return;
    }
    const observer = new MutationObserver(() => {
      try {
        ensureFilterBar();
      } catch (error) {
        // Silent: never break the host page.
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      ensureFilterBar();
    } catch (error) {
      // Silent: never break the host page.
    }
  }

  try {
    if (typeof window === 'undefined' || window[LOADED_FLAG] === true) {
      return;
    }
    window[LOADED_FLAG] = true;
    const style = document.createElement('style');
    style.textContent = [
      '#' + FILTER_BAR_ID +
        ' { position: sticky; top: 0; z-index: 9999; display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: rgba(255, 255, 255, 0.98); border-bottom: 1px solid rgba(15, 15, 15, 0.2); color: #333; font-size: 13px; }',
      '#' + FILTER_BAR_ID + ' input { flex: 1 1 auto; min-width: 100px; padding: 4px 8px; font-size: 13px; color: #333; background: #fff; border: 1px solid rgba(15, 15, 15, 0.35); border-radius: 4px; outline: none; }',
      '#' + FILTER_BAR_ID + ' input:focus { border-color: #646cff; }',
      '#' + FILTER_BAR_ID + ' span { flex: 0 0 auto; white-space: nowrap; color: #666; }',
      '.' + HIDDEN_CLASS + ' { display: none !important; }',
      '@media (prefers-color-scheme: dark) { #' + FILTER_BAR_ID +
        ' { background: rgba(26, 26, 26, 0.98); border-bottom-color: rgba(255, 255, 255, 0.2); color: #ddd; } #' + FILTER_BAR_ID +
        ' input { color: #ddd; background: #2a2a2a; border-color: rgba(255, 255, 255, 0.3); } #' + FILTER_BAR_ID +
        ' span { color: #999; } }',
    ].join('\\n');
    document.head.appendChild(style);
    if (document.readyState === 'loading') {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          try {
            init();
          } catch (error) {
            // Silent: never break the host page.
          }
        },
        { once: true },
      );
    } else {
      init();
    }
  } catch (error) {
    // Silent: never break the host page.
  }
})();
`;
