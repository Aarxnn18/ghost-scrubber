/**
 * ============================================================
 * GHOST SCRUBBER — script.js
 * Standalone browser-side data cleaning engine
 * No server. No API keys. No dependencies.
 * ============================================================
 */

'use strict';

// ─── STATE ───────────────────────────────────────────────────
const state = {
  modes: {
    dedup:      true,
    whitespace: true,
    broken:     true,
    uk:         false,
    trimLines:  false,
    blankLines: false,
    lowercase:  false,
    sort:       false,
  },
  ukOpts: {
    currency: true,
    dates:    true,
    vat:      true,
    ni:       true,
    utr:      true,
    phone:    true,
    postcode: true,
  },
  auto:      false,
  lastInput: '',
  report:    null,
};

// ─── DOM REFS ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const inputArea   = $('input-area');
const outputArea  = $('output-area');
const inputStats  = $('input-stats');
const outputStats = $('output-stats');
const reportBar   = $('report-bar');
const reportGrid  = $('report-grid');
const reportLog   = $('report-log');
const consoleLog  = $('console-log');
const ukPanel     = $('uk-panel');

// ─── LOGGING ─────────────────────────────────────────────────
function log(msg, cls = '') {
  const el = document.createElement('div');
  el.className = 'log-line' + (cls ? ' ' + cls : '');
  el.textContent = msg;
  consoleLog.appendChild(el);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

// ─── STATS COUNTER ────────────────────────────────────────────
function updateStats(text, el) {
  const lines = text ? text.split('\n').length : 0;
  const chars = text ? text.length : 0;
  el.textContent = `${lines.toLocaleString()} line${lines !== 1 ? 's' : ''} \u2022 ${chars.toLocaleString()} char${chars !== 1 ? 's' : ''}`;
}

inputArea.addEventListener('input', () => {
  updateStats(inputArea.value, inputStats);
  if (state.auto) scrub();
});

// ─── TOGGLE BUTTONS ──────────────────────────────────────────
function bindToggle(btnId, key, extra) {
  const btn = $(btnId);
  btn.addEventListener('click', () => {
    state.modes[key] = !state.modes[key];
    btn.classList.toggle('active', state.modes[key]);
    if (extra) extra(state.modes[key]);
    if (state.auto) scrub();
  });
}

bindToggle('btn-dedup',      'dedup');
bindToggle('btn-whitespace', 'whitespace');
bindToggle('btn-broken',     'broken');
bindToggle('btn-trim-lines', 'trimLines');
bindToggle('btn-blank-lines','blankLines');
bindToggle('btn-lowercase',  'lowercase');
bindToggle('btn-sort',       'sort');
bindToggle('btn-uk',         'uk', active => {
  ukPanel.style.display = active ? 'block' : 'none';
});

// UK sub-options
['currency','dates','vat','ni','utr','phone','postcode'].forEach(key => {
  const el = $('uk-' + key);
  el.addEventListener('change', () => {
    state.ukOpts[key] = el.checked;
    if (state.auto) scrub();
  });
});

// Auto toggle
$('btn-auto').addEventListener('click', () => {
  state.auto = !state.auto;
  $('btn-auto').classList.toggle('active', state.auto);
  log(state.auto ? 'Auto-scrub enabled.' : 'Auto-scrub disabled.', state.auto ? 'ok' : '');
  if (state.auto) scrub();
});

// ─── FILE LOAD ────────────────────────────────────────────────
$('btn-load-file').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    inputArea.value = ev.target.result;
    updateStats(inputArea.value, inputStats);
    log(`Loaded: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`, 'ok');
    if (state.auto) scrub();
  };
  reader.readAsText(file);
  e.target.value = '';
});

// ─── CLEAR INPUT ─────────────────────────────────────────────
$('btn-clear-input').addEventListener('click', () => {
  inputArea.value = '';
  updateStats('', inputStats);
  log('Input cleared.');
});

// ─── COPY OUTPUT ─────────────────────────────────────────────
$('btn-copy').addEventListener('click', () => {
  if (!outputArea.value) return;
  navigator.clipboard.writeText(outputArea.value).then(() => {
    showToast('COPIED TO CLIPBOARD');
    log('Output copied to clipboard.', 'ok');
  });
});

// ─── DOWNLOAD OUTPUT ─────────────────────────────────────────
$('btn-download').addEventListener('click', () => {
  if (!outputArea.value) return;
  const blob = new Blob([outputArea.value], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const ts   = new Date().toISOString().slice(0,19).replace(/[:T]/g, '-');
  a.href     = url;
  a.download = `ghost-scrubber-${ts}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  log(`Downloaded: ghost-scrubber-${ts}.txt`, 'ok');
});

// ─── TOAST ────────────────────────────────────────────────────
function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

// ─── SCRUB BUTTON ─────────────────────────────────────────────
$('btn-scrub').addEventListener('click', scrub);

// ─────────────────────────────────────────────────────────────
//  CORE SCRUBBING ENGINE
// ─────────────────────────────────────────────────────────────

function scrub() {
  const raw = inputArea.value;
  if (!raw.trim()) {
    log('Nothing to scrub — input is empty.', 'warn');
    return;
  }

  const t0 = performance.now();
  const report = {
    inputLines:      0,
    outputLines:     0,
    dupsRemoved:     0,
    brokenRemoved:   0,
    whitespaceFixed: 0,
    blankRemoved:    0,
    ukTransforms:    0,
    log:             [],
  };

  let lines = raw.split('\n');
  report.inputLines = lines.length;

  // ── 1. TRIM LINES ────────────────────────────────────────
  if (state.modes.trimLines) {
    const before = lines.map(l => l.length).reduce((a, b) => a + b, 0);
    lines = lines.map(l => l.trim());
    const after = lines.map(l => l.length).reduce((a, b) => a + b, 0);
    const saved = before - after;
    if (saved > 0) {
      report.whitespaceFixed += saved;
      report.log.push(`Trimmed leading/trailing whitespace: ${saved} chars removed.`);
    }
  }

  // ── 2. FIX INTERNAL WHITESPACE ───────────────────────────
  if (state.modes.whitespace) {
    let count = 0;
    lines = lines.map(line => {
      const fixed = line
        .replace(/\t/g, ' ')
        .replace(/[ \u00A0\u200B\u2009\u202F]+/g, match => {
          if (match.length > 1) { count += match.length - 1; return ' '; }
          return match;
        });
      return fixed;
    });
    if (count > 0) {
      report.whitespaceFixed += count;
      report.log.push(`Collapsed ${count} redundant whitespace character${count !== 1 ? 's' : ''}.`);
    }
  }

  // ── 3. STRIP BROKEN/NON-PRINTABLE CHARACTERS ────────────
  if (state.modes.broken) {
    let count = 0;
    lines = lines.map(line => {
      const cleaned = line.replace(
        // Strip C0 controls (except tab/LF/CR), C1 controls, surrogates, PUA,
        // zero-width and invisible unicode, replacement chars, BOM
        /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F\uFFFD\uFFFE\uFFFF\u200B-\u200D\u2028\u2029\uFEFF\uD800-\uDFFF]/g,
        match => { count += match.length; return ''; }
      );
      return cleaned;
    });
    if (count > 0) {
      report.brokenRemoved = count;
      report.log.push(`Stripped ${count} broken/non-printable character${count !== 1 ? 's' : ''}.`, 'highlight');
    }
  }

  // ── 4. REMOVE BLANK LINES ────────────────────────────────
  if (state.modes.blankLines) {
    const before = lines.length;
    lines = lines.filter(l => l.trim().length > 0);
    const removed = before - lines.length;
    if (removed > 0) {
      report.blankRemoved = removed;
      report.log.push(`Removed ${removed} blank line${removed !== 1 ? 's' : ''}.`);
    }
  }

  // ── 5. REMOVE DUPLICATES ─────────────────────────────────
  if (state.modes.dedup) {
    const seen = new Map(); // normalised → first-seen original
    const unique = [];
    for (const line of lines) {
      const key = line.trim().toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, line);
        unique.push(line);
      } else {
        report.dupsRemoved++;
      }
    }
    lines = unique;
    if (report.dupsRemoved > 0) {
      report.log.push(`Removed ${report.dupsRemoved} duplicate line${report.dupsRemoved !== 1 ? 's' : ''}.`, 'highlight');
    }
  }

  // ── 6. LOWERCASE ─────────────────────────────────────────
  if (state.modes.lowercase) {
    lines = lines.map(l => l.toLowerCase());
    report.log.push('Normalised all text to lowercase.');
  }

  // ── 7. SORT ───────────────────────────────────────────────
  if (state.modes.sort) {
    lines = [...lines].sort((a, b) =>
      a.trim().localeCompare(b.trim(), 'en-GB', { sensitivity: 'base' })
    );
    report.log.push('Lines sorted alphabetically (A→Z, en-GB locale).');
  }

  // ── 8. UK TAX MODE ───────────────────────────────────────
  if (state.modes.uk) {
    const results = applyUkMode(lines, state.ukOpts);
    lines = results.lines;
    report.ukTransforms = results.count;
    report.log.push(...results.log);
  }

  // ── FINALISE ─────────────────────────────────────────────
  const output = lines.join('\n');
  outputArea.value = output;
  updateStats(output, outputStats);
  report.outputLines = lines.length;

  const t1 = performance.now();
  const ms = (t1 - t0).toFixed(1);

  renderReport(report, ms);
  log(`Scrub complete in ${ms}ms. ${report.inputLines} → ${report.outputLines} lines.`, 'ok');
}

// ─────────────────────────────────────────────────────────────
//  UK TAX MODE ENGINE
// ─────────────────────────────────────────────────────────────

function applyUkMode(lines, opts) {
  let count = 0;
  const log = [];

  // Regex library — all compiled once
  const RX = {
    // GBP: bare numbers that look like currency amounts e.g. 1234.56 or 1,234.56
    gbpBare:   /(?<![£$€])\b(\d{1,3}(?:,\d{3})*|\d+)(\.\d{2})\b(?!\s*%)/g,
    // Already has pound sign — reformat comma grouping
    gbpSign:   /£\s*(\d[\d,]*(?:\.\d{1,2})?)/g,

    // Dates — various common formats → DD/MM/YYYY
    // YYYY-MM-DD (ISO)
    dateISO:   /\b(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})\b/g,
    // DD-MM-YYYY or DD.MM.YYYY
    dateDMY:   /\b(\d{1,2})[.\-](\d{1,2})[.\-](\d{4})\b/g,
    // Already in DD/MM/YYYY — leave but normalise padding
    dateDMYsl: /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,

    // VAT: GB + 9 digits (with optional spaces/dashes)
    vat:       /\b(GB\s*\d{3}\s*\d{4}\s*\d{2}(?:\s*\d{3})?)\b/gi,
    vatBare:   /\b(\d{3}[- ]?\d{4}[- ]?\d{2})\b/g,

    // NI: 2 letters, 6 digits, 1 letter (ABCDEFGHIJKLMNPQRSTWXYZ prefix pairs)
    ni:        /\b([A-CEGHJ-PR-TW-Z]{1}[A-CEGHJ-NPR-TW-Z]{1}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D])\b/gi,

    // UTR: 10-digit number (Unique Taxpayer Reference)
    utr:       /\b(\d{5}[- ]?\d{5})\b/g,

    // UK Phone: various formats → +44 or 0xxx
    phonePrefixed: /\b(\+44[\s\-]?\(?\d+\)?[\s\-]?\d+[\s\-]?\d+[\s\-]?\d*)\b/g,
    phoneMobile:   /\b(07\d{3}[\s\-]?\d{6})\b/g,
    phoneLandline: /\b(0[1-9]\d{1,4}[\s\-]?\d{4,8})\b/g,

    // UK Postcode: canonical form
    postcode: /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/gi,
  };

  const transformed = lines.map(line => {
    let out = line;
    let lineChanged = false;
    const mark = () => { if (!lineChanged) { count++; lineChanged = true; } };

    // ── GBP CURRENCY ────────────────────────────────────────
    if (opts.currency) {
      // Reformat existing £ signs
      out = out.replace(RX.gbpSign, (_, num) => {
        const formatted = formatGBP(num.replace(/,/g, ''));
        mark();
        return formatted;
      });

      // Tag bare decimal numbers that look like prices (context: near £, GBP, pence, price, cost, total, amount, fee, VAT)
      if (/£|GBP|pence|price|cost|total|amount|fee|vat/i.test(out)) {
        out = out.replace(RX.gbpBare, (match, int, dec) => {
          mark();
          return formatGBP(int.replace(/,/g, '') + dec);
        });
      }
    }

    // ── DATES ────────────────────────────────────────────────
    if (opts.dates) {
      // ISO YYYY-MM-DD → DD/MM/YYYY
      out = out.replace(RX.dateISO, (_, y, m, d) => {
        if (!isValidDate(+d, +m, +y)) return _;
        mark();
        return `${pad(d)}/${pad(m)}/${y}`;
      });

      // DD-MM-YYYY / DD.MM.YYYY → DD/MM/YYYY
      out = out.replace(RX.dateDMY, (_, d, m, y) => {
        if (!isValidDate(+d, +m, +y)) return _;
        mark();
        return `${pad(d)}/${pad(m)}/${y}`;
      });

      // Normalise DD/MM/YYYY padding
      out = out.replace(RX.dateDMYsl, (_, d, m, y) => {
        if (!isValidDate(+d, +m, +y)) return _;
        const normalised = `${pad(d)}/${pad(m)}/${y}`;
        if (normalised !== _) mark();
        return normalised;
      });
    }

    // ── VAT NUMBERS ──────────────────────────────────────────
    if (opts.vat) {
      out = out.replace(RX.vat, (_, vatNum) => {
        const clean = vatNum.replace(/\s/g, '');
        const formatted = `GB ${clean.slice(2,5)} ${clean.slice(5,9)} ${clean.slice(9,11)}`;
        mark();
        return `[VAT: ${formatted}]`;
      });
    }

    // ── NI NUMBERS ───────────────────────────────────────────
    if (opts.ni) {
      out = out.replace(RX.ni, (_, ni) => {
        const clean = ni.replace(/\s/g, '').toUpperCase();
        const formatted = `${clean.slice(0,2)} ${clean.slice(2,4)} ${clean.slice(4,6)} ${clean.slice(6,8)} ${clean.slice(8)}`;
        mark();
        return `[NI: ${formatted}]`;
      });
    }

    // ── UTR NUMBERS ──────────────────────────────────────────
    if (opts.utr) {
      // Only tag if the line contains UTR keyword context or it's clearly 10 digits
      if (/UTR|taxpayer|tax\s*ref/i.test(out)) {
        out = out.replace(RX.utr, (_, utr) => {
          const clean = utr.replace(/[- ]/g, '');
          if (clean.length !== 10) return _;
          mark();
          return `[UTR: ${clean}]`;
        });
      }
    }

    // ── PHONE NUMBERS ────────────────────────────────────────
    if (opts.phone) {
      out = out.replace(RX.phonePrefixed, (_, ph) => {
        const formatted = formatUKPhone(ph);
        if (formatted !== ph) mark();
        return formatted;
      });
      out = out.replace(RX.phoneMobile, (_, ph) => {
        const formatted = formatUKPhone(ph);
        if (formatted !== ph) mark();
        return formatted;
      });
    }

    // ── POSTCODES ────────────────────────────────────────────
    if (opts.postcode) {
      out = out.replace(RX.postcode, (_, outward, inward) => {
        const formatted = `${outward.toUpperCase()} ${inward.toUpperCase()}`;
        mark();
        return formatted;
      });
    }

    return out;
  });

  // Build log entries
  if (count > 0) {
    log.push(`UK Tax Mode: applied ${count} transformation${count !== 1 ? 's' : ''} across ${transformed.length} lines.`);
    if (opts.currency) log.push('  GBP: currency values normalised to £X,XXX.XX format.');
    if (opts.dates)    log.push('  Dates: normalised to DD/MM/YYYY (UK standard).');
    if (opts.vat)      log.push('  VAT numbers tagged [VAT: GB XXX XXXX XX].');
    if (opts.ni)       log.push('  NI numbers tagged [NI: XX XX XX XX X].');
    if (opts.utr)      log.push('  UTR numbers tagged where context confirmed.');
    if (opts.phone)    log.push('  UK phone numbers formatted.');
    if (opts.postcode) log.push('  Postcodes normalised to XX XX format.');
  } else {
    log.push('UK Tax Mode: no transformations needed — data already clean.');
  }

  return { lines: transformed, count, log };
}

// ─── UK HELPERS ───────────────────────────────────────────────

function formatGBP(numStr) {
  // numStr: raw digits with optional decimal, e.g. "1234.56"
  const num = parseFloat(numStr);
  if (isNaN(num)) return numStr;
  return '£' + num.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pad(n) {
  return String(+n).padStart(2, '0');
}

function isValidDate(d, m, y) {
  if (m < 1 || m > 12 || d < 1 || y < 1000 || y > 2100) return false;
  const daysInMonth = [0,31,
    (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 29 : 28,
    31,30,31,30,31,31,30,31,30,31];
  return d <= daysInMonth[m];
}

function formatUKPhone(raw) {
  // Strip everything except digits and leading +
  const stripped = raw.replace(/[^\d+]/g, '');

  // +44 prefix
  if (stripped.startsWith('+44')) {
    const local = stripped.slice(3);
    return formatLocalPhone('+44', local);
  }

  // 07xxx mobile
  if (/^07\d{9}$/.test(stripped)) {
    return `${stripped.slice(0,5)} ${stripped.slice(5)}`;
  }

  // 01/02 landline
  if (/^0[12]\d{9,10}$/.test(stripped)) {
    return `${stripped.slice(0,4)} ${stripped.slice(4,7)} ${stripped.slice(7)}`;
  }

  return raw;
}

function formatLocalPhone(prefix, local) {
  if (/^7\d{9}$/.test(local)) {
    return `${prefix} ${local.slice(0,4)} ${local.slice(4)}`;
  }
  if (/^[12]\d{9}$/.test(local)) {
    return `${prefix} ${local.slice(0,3)} ${local.slice(3,7)} ${local.slice(7)}`;
  }
  return `${prefix} ${local}`;
}

// ─────────────────────────────────────────────────────────────
//  REPORT RENDERER
// ─────────────────────────────────────────────────────────────

function renderReport(report, ms) {
  const linesRemoved = report.inputLines - report.outputLines;
  const charsFixed   = report.whitespaceFixed + report.brokenRemoved;

  const stats = [
    { value: report.inputLines.toLocaleString(),  label: 'lines in' },
    { value: report.outputLines.toLocaleString(), label: 'lines out' },
    { value: linesRemoved.toLocaleString(),        label: 'lines removed' },
    { value: report.dupsRemoved.toLocaleString(),  label: 'duplicates' },
    { value: charsFixed.toLocaleString(),          label: 'chars fixed' },
    { value: `${ms}ms`,                            label: 'scrub time' },
  ];

  if (state.modes.uk && report.ukTransforms > 0) {
    stats.push({ value: report.ukTransforms.toLocaleString(), label: 'UK transforms' });
  }

  reportGrid.innerHTML = stats.map(s =>
    `<div class="report-stat">
      <span class="report-stat-value">${s.value}</span>
      <span class="report-stat-label">${s.label}</span>
    </div>`
  ).join('');

  reportLog.innerHTML = report.log.map((item, i) =>
    `<div class="report-log-item${i === 0 ? ' highlight' : ''}">${escapeHtml(item)}</div>`
  ).join('');

  reportBar.style.display = 'block';
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── INIT ─────────────────────────────────────────────────────
(function init() {
  updateStats('', inputStats);
  updateStats('', outputStats);
  log('All engines loaded. No network calls made.', 'dim');
})();