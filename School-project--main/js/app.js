/* ──────────────────────────────────────────────────────────────
   FOLIO · app.js
   Plain-text editor + AI features (quiz, summarize, notes)
   ────────────────────────────────────────────────────────────── */

/* ─── STORAGE KEYS ────────────────────────────────────────── */
const KEY_API       = 'folio_groq_api_key';
const KEY_DOC       = 'folio_document';
const KEY_DOC_NAME  = 'folio_document_name';
const KEY_FONT_SIZE = 'folio_font_size';
const KEY_NOTES     = 'folio_notes';
const KEY_QUIZ_BEST = 'folio_quiz_best';

const Store = {
  get(k, fallback)  { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v)         { localStorage.setItem(k, JSON.stringify(v)); },
  raw(k, fallback)  { return localStorage.getItem(k) ?? fallback; },
  rawSet(k, v)      { localStorage.setItem(k, v); },
  remove(k)         { localStorage.removeItem(k); },
};

/* ─── GROQ API ─────────────────────────────────────────────── */

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function hasApiKey() { return !!Store.raw(KEY_API, ''); }

async function callGroq(messages, opts = {}) {
  const key = Store.raw(KEY_API, '');
  if (!key) throw new Error('No Groq API key set. Add one on the Support page.');

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model: opts.model || GROQ_MODEL,
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.max_tokens ?? 1024,
    })
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch {}
    throw new Error(`Groq error ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

/* ─── API BANNER ──────────────────────────────────────────── */
function injectApiBanner() {
  if (hasApiKey()) return;
  const body = document.body;
  if (body.dataset.requiresApi !== 'true') return;
  const banner = document.createElement('div');
  banner.className = 'api-banner';
  const linkPrefix = body.dataset.page === 'index' ? 'pages/' : '';
  banner.innerHTML = `Add your free Groq API key to use the AI features.
    <a href="${linkPrefix}support.html#api">Set it up →</a>`;
  body.insertBefore(banner, body.firstChild);
}

/* ─── EDITOR (HOMEPAGE) ───────────────────────────────────── */

function initEditor() {
  const filenameEl  = document.getElementById('filename');
  const editorEl    = document.getElementById('editor');
  const fileInput   = document.getElementById('file-input');
  const openBtn     = document.getElementById('btn-open');
  const saveBtn     = document.getElementById('btn-save');
  const newBtn      = document.getElementById('btn-new');
  const fontUpBtn   = document.getElementById('btn-font-up');
  const fontDownBtn = document.getElementById('btn-font-down');
  const fontSizeEl  = document.getElementById('font-size');
  const wordsEl     = document.getElementById('stat-words');
  const charsEl     = document.getElementById('stat-chars');
  const linesEl     = document.getElementById('stat-lines');
  const saveStatus  = document.getElementById('save-status');
  const aiSummarizeBtn = document.getElementById('ai-summarize');
  const aiQuizBtn   = document.getElementById('ai-quiz');

  // Restore previous document
  const savedDoc  = Store.raw(KEY_DOC, '');
  const savedName = Store.raw(KEY_DOC_NAME, '');
  if (savedDoc) editorEl.value = savedDoc;
  if (savedName) filenameEl.value = savedName;

  // Restore font size
  let fontSize = parseInt(Store.raw(KEY_FONT_SIZE, '17'), 10);
  applyFontSize();

  function applyFontSize() {
    fontSize = Math.min(28, Math.max(12, fontSize));
    editorEl.style.fontSize = fontSize + 'px';
    fontSizeEl.textContent = fontSize;
    Store.rawSet(KEY_FONT_SIZE, String(fontSize));
  }

  // Stats
function updateStats() {
  const text = editorEl.value;

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;

  // عدد الأسطر من Enter
  const linesFromBreaks = text === '' ? 0 : text.split('\n').length;

  // حساب التفاف النص (wrap)
  const avgCharsPerLine = Math.floor(editorEl.clientWidth / 10);

  let extraLines = 0;

  text.split('\n').forEach(line => {
    extraLines += Math.floor(line.length / avgCharsPerLine);
  });

  const lines = linesFromBreaks + extraLines;

  wordsEl.textContent = words.toLocaleString();
  charsEl.textContent = chars.toLocaleString();
  linesEl.textContent = lines.toLocaleString();
}

  // Auto-save (debounced)
  let saveTimer = null;
  function markDirty() {
    saveStatus.classList.add('dirty');
    saveStatus.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      Store.rawSet(KEY_DOC, editorEl.value);
      Store.rawSet(KEY_DOC_NAME, filenameEl.value);
      saveStatus.classList.remove('dirty');
      saveStatus.textContent = 'Auto-saved';
    }, 400);
  }

  editorEl.addEventListener('input', () => { updateStats(); markDirty(); });
  filenameEl.addEventListener('input', markDirty);

  // Open file
  openBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('File is too large. Folio is best with documents under 5 MB.');
      return;
    }
    try {
      const text = await file.text();
      editorEl.value = text;
      filenameEl.value = file.name;
      updateStats();
      markDirty();
      editorEl.focus();
    } catch (err) {
      alert('Could not read file: ' + err.message);
    }
    fileInput.value = ''; // allow re-opening the same file
  });

  // Save file (download)
  saveBtn.addEventListener('click', () => {
    const text = editorEl.value;
    let name = filenameEl.value.trim() || 'untitled.txt';
    if (!/\.[a-z0-9]{1,6}$/i.test(name)) name += '.txt';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // New document
  newBtn.addEventListener('click', () => {
    if (editorEl.value.trim() && !confirm('Discard the current document? Anything unsaved will be lost.')) return;
    editorEl.value = '';
    filenameEl.value = '';
    updateStats();
    markDirty();
    editorEl.focus();
  });

  // Font size
  fontUpBtn.addEventListener('click', () => { fontSize += 1; applyFontSize(); });
  fontDownBtn.addEventListener('click', () => { fontSize -= 1; applyFontSize(); });

  // AI quick actions — navigate to relevant pages with current document
  aiSummarizeBtn.addEventListener('click', () => {
    Store.rawSet(KEY_DOC, editorEl.value);
    Store.rawSet(KEY_DOC_NAME, filenameEl.value);
    window.location.href = 'pages/summarize.html?source=doc';
  });

  aiQuizBtn.addEventListener('click', () => {
    Store.rawSet(KEY_DOC, editorEl.value);
    Store.rawSet(KEY_DOC_NAME, filenameEl.value);
    window.location.href = 'pages/quiz.html?source=doc';
  });

  // Keyboard shortcuts
  editorEl.addEventListener('keydown', (e) => {
    const meta = e.ctrlKey || e.metaKey;
    if (meta && e.key === 's') { e.preventDefault(); saveBtn.click(); }
    if (meta && e.key === 'o') { e.preventDefault(); openBtn.click(); }
    if (e.key === 'Tab') {
      // insert two spaces, don't move focus
      e.preventDefault();
      const start = editorEl.selectionStart;
      const end = editorEl.selectionEnd;
      editorEl.setRangeText('  ', start, end, 'end');
      markDirty();
      updateStats();
    }
  });

  updateStats();
  saveStatus.textContent = savedDoc ? 'Auto-saved' : 'Empty';
}

/* ─── NOTES PAGE ──────────────────────────────────────────── */

function initNotes() {
  const titleEl = document.getElementById('note-title');
  const bodyEl  = document.getElementById('note-body');
  const saveBtn = document.getElementById('note-save');
  const clearBtn = document.getElementById('note-clear');
  const listEl  = document.getElementById('notes-list');
  const emptyEl = document.getElementById('notes-empty');

  function render() {
    const notes = Store.get(KEY_NOTES, []);
    listEl.innerHTML = '';
    if (!notes.length) { emptyEl.style.display = 'block'; return; }
    emptyEl.style.display = 'none';
    notes.forEach((n, i) => {
      const li = document.createElement('li');
      li.className = 'note-card';
      li.innerHTML = `
        <div class="note-card-header">
          <div class="note-title">${escapeHtml(n.title || 'Untitled')}</div>
          <div class="note-date">${formatDate(n.created)}</div>
        </div>
        <div class="note-body">${escapeHtml(n.body)}</div>
        ${n.summary ? `
          <div class="note-summary">
            <span class="note-summary-label">Summary</span>${escapeHtml(n.summary)}
          </div>` : ''}
        <div class="note-card-actions">
          <button class="btn ghost small" data-act="sum">Summarize</button>
          <button class="btn ghost small" data-act="del">Delete</button>
        </div>
      `;
      const sumBtn = li.querySelector('[data-act="sum"]');
      const delBtn = li.querySelector('[data-act="del"]');

      sumBtn.addEventListener('click', async () => {
        if (!hasApiKey()) { alert('Set your Groq API key on the Support page first.'); return; }
        sumBtn.disabled = true;
        sumBtn.textContent = 'Summarizing…';
        try {
          const out = await callGroq([
            { role: 'system', content: 'You write concise, faithful 2–3 sentence summaries. Plain prose. No preamble.' },
            { role: 'user', content: `Summarize this note:\n\n${n.body}` }
          ], { temperature: 0.3, max_tokens: 220 });
          const all = Store.get(KEY_NOTES, []);
          all[i].summary = out;
          Store.set(KEY_NOTES, all);
          render();
        } catch (err) {
          alert(err.message);
        } finally {
          sumBtn.disabled = false;
          sumBtn.textContent = 'Summarize';
        }
      });

      delBtn.addEventListener('click', () => {
        if (!confirm('Delete this note?')) return;
        const all = Store.get(KEY_NOTES, []);
        all.splice(i, 1);
        Store.set(KEY_NOTES, all);
        render();
      });

      listEl.appendChild(li);
    });
  }

  saveBtn.addEventListener('click', () => {
    const title = titleEl.value.trim();
    const body  = bodyEl.value.trim();
    if (!body) { bodyEl.focus(); return; }
    const notes = Store.get(KEY_NOTES, []);
    notes.unshift({ title, body, created: Date.now(), summary: '' });
    Store.set(KEY_NOTES, notes);
    titleEl.value = '';
    bodyEl.value  = '';
    render();
  });

  clearBtn.addEventListener('click', () => {
    titleEl.value = '';
    bodyEl.value = '';
    titleEl.focus();
  });

  render();
}

/* ─── QUIZ PAGE — AI-generated from document text ─────────── */

function initQuiz() {
  const sourceEl = document.getElementById('quiz-source-text');
  const useDocBtn = document.getElementById('use-doc');
  const startBtn = document.getElementById('start-quiz');
  const sourceCard = document.getElementById('quiz-source-card');
  const card = document.getElementById('quiz-card');
  const finish = document.getElementById('quiz-finish');
  const progressEl = document.getElementById('quiz-progress');
  const questionEl = document.getElementById('quiz-question');
  const choicesEl = document.getElementById('quiz-choices');
  const scoreEl = document.getElementById('quiz-score');
  const nextBtn = document.getElementById('quiz-next');
  const finishScore = document.getElementById('finish-score');
  const finishBest  = document.getElementById('finish-best');
  const restartBtn  = document.getElementById('quiz-restart');
  const newSourceBtn = document.getElementById('quiz-new-source');

  let questions = [];
  let idx = 0;
  let score = 0;
  let answered = false;

  // Pre-fill from document if ?source=doc
  const params = new URLSearchParams(location.search);
  if (params.get('source') === 'doc') {
    const doc = Store.raw(KEY_DOC, '');
    if (doc) sourceEl.value = doc;
  }

  useDocBtn.addEventListener('click', () => {
    const doc = Store.raw(KEY_DOC, '');
    if (!doc.trim()) { alert('No document found. Open or write one in the editor first.'); return; }
    sourceEl.value = doc;
    sourceEl.focus();
  });

  startBtn.addEventListener('click', async () => {
    const text = sourceEl.value.trim();
    if (!text) { sourceEl.focus(); return; }
    if (text.length < 200) {
      if (!confirm('That text is quite short — the quiz may be thin. Continue anyway?')) return;
    }
    if (!hasApiKey()) { alert('Set your Groq API key on the Support page first.'); return; }

    startBtn.disabled = true;
    startBtn.innerHTML = '<span class="loading">Generating quiz…</span>';

    try {
      const resp = await callGroq([
        { role: 'system', content: 'You create multiple-choice quizzes that test comprehension of a passage. Return ONLY a JSON array, no preamble, no code fences. Schema: [{"question":string,"choices":[string,string,string,string],"answer":number}]. Generate 6-8 questions. answer is the 0-indexed correct choice. Test understanding, key facts, inferences, and definitions present in the text. Do not test trivial wording or details not in the text. All four choices should be plausible.' },
        { role: 'user', content: `Make a quiz from this passage:\n\n${text}` }
      ], { temperature: 0.4, max_tokens: 2400 });

      const arr = parseLooseJson(resp);
      if (!Array.isArray(arr) || arr.length === 0) throw new Error('Could not parse quiz from model output.');
      // Validate
      questions = arr.filter(q =>
        q && typeof q.question === 'string'
          && Array.isArray(q.choices) && q.choices.length === 4
          && q.choices.every(c => typeof c === 'string')
          && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4
      );
      if (!questions.length) throw new Error('No valid questions in the model output.');

      idx = 0; score = 0;
      sourceCard.style.display = 'none';
      card.style.display = 'block';
      finish.style.display = 'none';
      renderQuestion();
    } catch (err) {
      alert('Could not generate quiz: ' + err.message);
    } finally {
      startBtn.disabled = false;
      startBtn.innerHTML = 'Generate quiz';
    }
  });

  function renderQuestion() {
    answered = false;
    nextBtn.style.display = 'none';
    const q = questions[idx];
    progressEl.textContent = `Question ${idx + 1} / ${questions.length}`;
    scoreEl.innerHTML = `Score <b>${score}</b> / ${questions.length}`;
    questionEl.textContent = q.question;

    choicesEl.innerHTML = '';
    q.choices.forEach((choice, i) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-choice';
      btn.innerHTML = `<span class="letter">${'ABCD'[i]}</span><span>${escapeHtml(choice)}</span>`;
      btn.addEventListener('click', () => answer(btn, i, q.answer));
      choicesEl.appendChild(btn);
    });
  }

  function answer(btn, chosenIdx, correctIdx) {
    if (answered) return;
    answered = true;
    const all = choicesEl.querySelectorAll('.quiz-choice');
    all.forEach(b => b.disabled = true);
    if (chosenIdx === correctIdx) {
      btn.classList.add('correct');
      score++;
    } else {
      btn.classList.add('wrong');
      all[correctIdx]?.classList.add('correct');
    }
    scoreEl.innerHTML = `Score <b>${score}</b> / ${questions.length}`;
    nextBtn.style.display = 'inline-flex';
    nextBtn.textContent = idx + 1 >= questions.length ? 'Finish' : 'Next →';
  }

  nextBtn.addEventListener('click', () => {
    idx++;
    if (idx >= questions.length) {
      const best = Store.get(KEY_QUIZ_BEST, 0);
      const pct = score / questions.length;
      const newBest = Math.max(best, pct);
      Store.set(KEY_QUIZ_BEST, newBest);
      card.style.display = 'none';
      finish.style.display = 'block';
      finishScore.textContent = `${score} / ${questions.length}`;
      finishBest.textContent = `${Math.round(newBest * 100)}%`;
      return;
    }
    renderQuestion();
  });

  restartBtn.addEventListener('click', () => {
    idx = 0; score = 0;
    finish.style.display = 'none';
    card.style.display = 'block';
    renderQuestion();
  });

  newSourceBtn.addEventListener('click', () => {
    finish.style.display = 'none';
    card.style.display = 'none';
    sourceCard.style.display = 'block';
  });
}

/* ─── SUMMARIZE PAGE ──────────────────────────────────────── */

function initSummarize() {
  const inputEl  = document.getElementById('sum-input');
  const outputEl = document.getElementById('sum-output');
  const runBtn   = document.getElementById('sum-run');
  const clearBtn = document.getElementById('sum-clear');
  const useDocBtn = document.getElementById('sum-use-doc');
  const lengthBtns = document.querySelectorAll('.length-toggle button');
  const meta = document.getElementById('sum-meta');

  let length = 'medium';

  // Pre-fill from document if ?source=doc
  const params = new URLSearchParams(location.search);
  if (params.get('source') === 'doc') {
    const doc = Store.raw(KEY_DOC, '');
    if (doc) inputEl.value = doc;
  }

  lengthBtns.forEach(b => b.addEventListener('click', () => {
    lengthBtns.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    length = b.dataset.len;
  }));

  const lengthSpec = {
    short:  '1–2 short sentences. Punchy.',
    medium: '3–5 sentences. A balanced overview.',
    long:   '6–10 sentences. Cover all main points and any notable details.',
  };

  useDocBtn.addEventListener('click', () => {
    const doc = Store.raw(KEY_DOC, '');
    if (!doc.trim()) { alert('No document found. Open or write one in the editor first.'); return; }
    inputEl.value = doc;
    inputEl.focus();
  });

  runBtn.addEventListener('click', async () => {
    const text = inputEl.value.trim();
    if (!text) { inputEl.focus(); return; }
    if (!hasApiKey()) { alert('Set your Groq API key on the Support page first.'); return; }
    runBtn.disabled = true;
    outputEl.classList.remove('empty');
    outputEl.innerHTML = `<div class="loading">Summarizing…</div>`;
    meta.textContent = 'Working…';
    try {
      const out = await callGroq([
        { role: 'system', content: `You write faithful, plain-prose summaries. Length target: ${lengthSpec[length]} No preamble. No bullet points unless the source is clearly a list.` },
        { role: 'user', content: text }
      ], { temperature: 0.3, max_tokens: length === 'long' ? 700 : length === 'medium' ? 350 : 150 });
      outputEl.textContent = out;
      const wordsIn  = text.split(/\s+/).filter(Boolean).length;
      const wordsOut = out.split(/\s+/).filter(Boolean).length;
      meta.textContent = `${wordsIn} → ${wordsOut} words`;
    } catch (err) {
      outputEl.textContent = err.message;
      meta.textContent = 'Error';
    } finally {
      runBtn.disabled = false;
    }
  });

  clearBtn.addEventListener('click', () => {
    inputEl.value = '';
    outputEl.classList.add('empty');
    outputEl.textContent = 'Your summary will appear here.';
    meta.textContent = 'Idle';
    inputEl.focus();
  });
}

/* ─── SUPPORT PAGE ────────────────────────────────────────── */

function initSupport() {
  const keyInput = document.getElementById('api-key');
  const saveBtn  = document.getElementById('api-save');
  const clearBtn = document.getElementById('api-clear');
  const testBtn  = document.getElementById('api-test');
  const status   = document.getElementById('api-status');
  const testOut  = document.getElementById('api-test-out');

  function refreshStatus() {
    if (hasApiKey()) {
      status.className = 'status-pill ok';
      status.textContent = 'Key saved';
    } else {
      status.className = 'status-pill no';
      status.textContent = 'Not set';
    }
  }

  if (Store.raw(KEY_API, '')) keyInput.placeholder = '•••••••••••••••••• (saved)';

  saveBtn.addEventListener('click', () => {
    const v = keyInput.value.trim();
    if (!v) { keyInput.focus(); return; }
    Store.rawSet(KEY_API, v);
    keyInput.value = '';
    keyInput.placeholder = '•••••••••••••••••• (saved)';
    testOut.textContent = '';
    refreshStatus();
  });

  clearBtn.addEventListener('click', () => {
    if (!confirm('Remove your saved Groq API key from this browser?')) return;
    Store.remove(KEY_API);
    keyInput.value = '';
    keyInput.placeholder = 'gsk_...';
    testOut.textContent = '';
    refreshStatus();
  });

  testBtn.addEventListener('click', async () => {
    if (!hasApiKey()) { testOut.textContent = 'Save a key first.'; return; }
    testBtn.disabled = true;
    testOut.innerHTML = `<span class="loading">Pinging Groq…</span>`;
    try {
      const out = await callGroq([{ role: 'user', content: 'Reply with the single word: pong' }], { temperature: 0, max_tokens: 10 });
      testOut.textContent = `✓ Connection works. Reply: "${out}"`;
    } catch (err) {
      testOut.textContent = '✗ ' + err.message;
    } finally {
      testBtn.disabled = false;
    }
  });

  refreshStatus();
}

/* ─── UTILITIES ───────────────────────────────────────────── */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

function parseLooseJson(s) {
  const cleaned = s.replace(/```json|```/g, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  // Try to find a JSON array first, then an object
  const arr = cleaned.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch {} }
  const obj = cleaned.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  return null;
}

/* ─── BOOT ────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  injectApiBanner();
  const page = document.body.dataset.page;
  switch (page) {
    case 'index':     initEditor();    break;
    case 'notes':     initNotes();     break;
    case 'quiz':      initQuiz();      break;
    case 'summarize': initSummarize(); break;
    case 'support':   initSupport();   break;
  }
});
