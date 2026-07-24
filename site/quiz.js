/* CRR Radar — "Learn" quiz. Static, client-side. Teaches regulatory-status
   discrimination: every question shows the rule, its legal basis, and the trap.
   Progress is saved in localStorage on this device only. */
window.Quiz = (function () {
  const PROGRESS_KEY = "crr_quiz_v1";

  let DATA = null;
  let container = null;
  let screen = "overview"; // overview | quiz | results
  let session = null; // { ids, idx, chosen:Set, checked, results:{id:bool} }
  let wired = false;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);

  const byId = (id) => DATA.questions.find((q) => q.id === id);
  const moduleOf = (key) => DATA.modules.find((m) => m.key === key);

  // ---- progress ----------------------------------------------------------
  function loadProgress() {
    try { return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; }
    catch { return {}; }
  }
  function saveResult(id, correct) {
    const p = loadProgress();
    const prev = p[id] || { seen: 0, correct: 0 };
    p[id] = { seen: prev.seen + 1, correct: prev.correct + (correct ? 1 : 0), last: correct };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  }
  function moduleStats(key) {
    const p = loadProgress();
    const qs = DATA.questions.filter((q) => q.module === key);
    const mastered = qs.filter((q) => p[q.id] && p[q.id].last).length;
    return { total: qs.length, mastered };
  }

  // ---- data --------------------------------------------------------------
  async function ensureData() {
    if (DATA) return;
    const resp = await fetch("data/quiz.json");
    DATA = await resp.json();
  }

  async function render(el) {
    if (el) container = el;
    if (!container) return;
    if (!wired) {
      container.addEventListener("click", onClick);
      wired = true;
    }
    if (!DATA) {
      container.innerHTML = `<div class="quiz-loading">Loading…</div>`;
      await ensureData();
    }
    draw();
  }

  function draw() {
    if (screen === "quiz") drawQuestion();
    else if (screen === "results") drawResults();
    else drawOverview();
  }

  // ---- overview ----------------------------------------------------------
  function drawOverview() {
    const m = DATA.meta || {};
    const ladder = (DATA.authority_ladder || [])
      .map(
        (r) => `<li class="ladder-row ${r.binding ? "binding" : "soft"}">
          <span class="ladder-tag">${r.binding ? "BINDING" : "NON-BINDING"}</span>
          <span class="ladder-level">${esc(r.level)}</span>
          <span class="ladder-eg">${esc(r.example)}</span>
        </li>`
      )
      .join("");

    const p = loadProgress();
    const answered = DATA.questions.filter((q) => p[q.id]).length;

    const modules = DATA.modules
      .map((mod) => {
        const s = moduleStats(mod.key);
        const pct = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
        return `<button class="quiz-mod" data-action="start-module" data-module="${esc(mod.key)}">
          <div class="quiz-mod-top">
            <span class="lvl lvl-${esc(mod.level.toLowerCase())}">${esc(mod.level)}</span>
            <span class="quiz-mod-prog">${s.mastered}/${s.total}</span>
          </div>
          <h4>${esc(mod.name)}</h4>
          <p>${esc(mod.blurb)}</p>
          <div class="quiz-bar"><span style="width:${pct}%"></span></div>
        </button>`;
      })
      .join("");

    container.innerHTML = `
      <div class="quiz-intro">
        <h2>${esc(m.title || "CRR Learn")}</h2>
        <p class="quiz-lede">${esc(m.intro || "")}</p>
        <div class="quiz-actions">
          <button class="quiz-primary" data-action="start-mixed">Start mixed quiz (${DATA.questions.length} questions)</button>
          <span class="quiz-answered">${answered} answered on this device</span>
        </div>
      </div>

      <div class="quiz-ladder-card">
        <div class="quiz-section-h">The authority ladder — the spine of the course</div>
        <ul class="quiz-ladder">${ladder}</ul>
      </div>

      <div class="quiz-section-h">Modules</div>
      <div class="quiz-mods">${modules}</div>

      <p class="quiz-disclaimer">${esc(m.disclaimer || "")}</p>`;
  }

  // ---- session -----------------------------------------------------------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function startModule(key) {
    const ids = DATA.questions.filter((q) => q.module === key).map((q) => q.id);
    beginSession(ids);
  }
  function startMixed() {
    beginSession(shuffle(DATA.questions.map((q) => q.id)));
  }
  function beginSession(ids) {
    session = { ids, idx: 0, chosen: new Set(), checked: false, results: {} };
    screen = "quiz";
    draw();
    container.scrollIntoView({ block: "start" });
  }

  // ---- question ----------------------------------------------------------
  function drawQuestion() {
    const q = byId(session.ids[session.idx]);
    const mod = moduleOf(q.module) || { name: q.module };
    const total = session.ids.length;
    const num = session.idx + 1;
    const multi = q.type === "multi";
    const answers = Array.isArray(q.answer) ? q.answer : [q.answer];

    const opts = q.options
      .map((opt, i) => {
        let cls = "quiz-opt";
        if (session.chosen.has(i)) cls += " chosen";
        if (session.checked) {
          if (answers.includes(i)) cls += " correct";
          else if (session.chosen.has(i)) cls += " wrong";
        }
        const mark = session.checked
          ? answers.includes(i) ? "✓" : session.chosen.has(i) ? "✗" : ""
          : "";
        return `<button class="${cls}" data-action="opt" data-i="${i}" ${session.checked ? "disabled" : ""}>
          <span class="quiz-opt-mark">${mark}</span><span>${esc(opt)}</span>
        </button>`;
      })
      .join("");

    const feedback = session.checked ? feedbackHTML(q, answers) : "";
    const isLast = session.idx === total - 1;
    const canCheck = session.chosen.size > 0;

    container.innerHTML = `
      <div class="quiz-run">
        <div class="quiz-run-head">
          <button class="quiz-back" data-action="to-overview">← Modules</button>
          <div class="quiz-progress"><span style="width:${(num / total) * 100}%"></span></div>
          <span class="quiz-count">${num} / ${total}</span>
        </div>
        <div class="quiz-q">
          <div class="quiz-q-meta">
            <span class="lvl lvl-${esc(q.level.toLowerCase())}">${esc(q.level)}</span>
            <span class="quiz-q-mod">${esc(mod.name)}</span>
            ${multi ? '<span class="quiz-multi">Select all that apply</span>' : ""}
            <span class="quiz-jur">${esc(q.jurisdiction || "EU")}</span>
          </div>
          <h3 class="quiz-prompt">${esc(q.prompt)}</h3>
          <div class="quiz-opts">${opts}</div>
          ${feedback}
          <div class="quiz-run-foot">
            ${
              session.checked
                ? `<button class="quiz-primary" data-action="${isLast ? "finish" : "next"}">${isLast ? "See results" : "Next question →"}</button>`
                : `<button class="quiz-primary" data-action="check" ${canCheck ? "" : "disabled"}>Check answer</button>`
            }
          </div>
        </div>
      </div>`;
  }

  function feedbackHTML(q, answers) {
    const correct = isCorrect(answers);
    return `<div class="quiz-fb ${correct ? "ok" : "no"}">
      <div class="quiz-fb-tag">${correct ? "Correct" : "Not quite"}</div>
      <p class="quiz-fb-exp">${esc(q.explanation)}</p>
      <dl class="quiz-fb-meta">
        <div><dt>Legal basis</dt><dd>${esc(q.legal_basis || "—")}</dd></div>
        ${q.status_note ? `<div><dt>Status</dt><dd>${esc(q.status_note)}</dd></div>` : ""}
        ${q.misconception ? `<div><dt>Common trap</dt><dd>${esc(q.misconception)}</dd></div>` : ""}
      </dl>
    </div>`;
  }

  function isCorrect(answers) {
    if (session.chosen.size !== answers.length) return false;
    return answers.every((i) => session.chosen.has(i));
  }

  // ---- results -----------------------------------------------------------
  function drawResults() {
    const total = session.ids.length;
    const correct = Object.values(session.results).filter(Boolean).length;
    const pct = total ? Math.round((correct / total) * 100) : 0;
    const wrongIds = session.ids.filter((id) => !session.results[id]);

    const review = wrongIds
      .map((id) => {
        const q = byId(id);
        return `<li><span class="quiz-review-x">✗</span>${esc(q.prompt)}
          <span class="quiz-review-basis">${esc(q.legal_basis || "")}</span></li>`;
      })
      .join("");

    const verdict =
      pct >= 90 ? "Excellent regulatory judgement." :
      pct >= 70 ? "Solid — mind the flagged traps." :
      pct >= 50 ? "Getting there — review the misses." :
      "Worth another pass — focus on source status.";

    container.innerHTML = `
      <div class="quiz-results">
        <div class="quiz-score">
          <div class="quiz-score-num">${pct}%</div>
          <div class="quiz-score-sub">${correct} of ${total} correct</div>
        </div>
        <p class="quiz-verdict">${verdict}</p>
        ${
          wrongIds.length
            ? `<div class="quiz-section-h">Review these</div><ul class="quiz-review">${review}</ul>`
            : `<p class="quiz-allright">Every question correct — nicely done.</p>`
        }
        <div class="quiz-actions">
          ${wrongIds.length ? `<button class="quiz-primary" data-action="retry-wrong">Retry the misses (${wrongIds.length})</button>` : ""}
          <button class="quiz-ghost" data-action="to-overview">Back to modules</button>
        </div>
      </div>`;
  }

  // ---- events ------------------------------------------------------------
  function onClick(e) {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;
    if (action === "start-module") return startModule(el.dataset.module);
    if (action === "start-mixed") return startMixed();
    if (action === "to-overview") { screen = "overview"; session = null; return draw(); }
    if (!session) return;
    if (action === "opt") {
      if (session.checked) return;
      const i = Number(el.dataset.i);
      const q = byId(session.ids[session.idx]);
      if (q.type === "multi") {
        session.chosen.has(i) ? session.chosen.delete(i) : session.chosen.add(i);
      } else {
        session.chosen = new Set([i]);
      }
      return draw();
    }
    if (action === "check") {
      const q = byId(session.ids[session.idx]);
      const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
      const correct = isCorrect(answers);
      session.checked = true;
      session.results[q.id] = correct;
      saveResult(q.id, correct);
      return draw();
    }
    if (action === "next") {
      session.idx++;
      session.chosen = new Set();
      session.checked = false;
      return draw();
    }
    if (action === "finish") { screen = "results"; return draw(); }
    if (action === "retry-wrong") {
      const wrongIds = session.ids.filter((id) => !session.results[id]);
      return beginSession(wrongIds);
    }
  }

  return { render };
})();
