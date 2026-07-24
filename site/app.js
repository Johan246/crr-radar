/* CRR Radar dashboard — plain JS, no build step. Reads data/items.json. */

const LAST_VISIT_KEY = "crr_radar_last_visit";

const state = {
  view: "feed", // feed | refs
  authorType: "all",
  org: "all",
  topics: new Set(),
  status: "all",
  persona: "all",
  q: "",
  showLowSignal: false,
};

let DATA = { items: [], topics: {}, sources: [], references: [] };
let lastVisit = null;

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

const STATUS_LABELS = {
  consultation: "Consultation",
  proposed_change: "Proposed change",
  final_rule: "Final rule",
  commentary: "Commentary",
};

function itemDate(item) {
  return (item.published_at || item.first_seen_at || "").slice(0, 10);
}

function isNew(item) {
  return lastVisit && item.first_seen_at > lastVisit;
}

function isLowSignal(item) {
  const r = item.reviews;
  return !!(r && r.quant && r.regulatory &&
    r.quant.relevance === "low" && r.regulatory.relevance === "low");
}

function matches(item) {
  if (state.authorType !== "all" && item.author_type !== state.authorType) return false;
  if (state.org !== "all" && item.source_org !== state.org) return false;
  if (state.status !== "all" && item.doc_status !== state.status) return false;
  if (state.topics.size && !item.topics.some((t) => state.topics.has(t))) return false;
  if (state.persona !== "all") {
    const rev = item.reviews && item.reviews[state.persona];
    if (!rev || rev.relevance === "low") return false;
  }
  if (state.q) {
    const hay = `${item.title} ${item.summary} ${item.why_it_matters} ${item.source_name}`.toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}

function fmtDay(iso) {
  if (!iso) return "Undated";
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

const REF_GROUPS = {
  legislation: "EU legislation",
  eba: "EBA standards & guidelines",
  ecb: "ECB supervisory guides",
  basel: "Basel framework",
  uk: "UK / PRA",
};

function relatedRefs(item) {
  return DATA.references
    .filter((r) => (r.topics || []).some((t) => item.topics.includes(t)))
    .slice(0, 3);
}

function relatedRefsHTML(item) {
  const refs = relatedRefs(item);
  if (!refs.length) return "";
  const links = refs
    .map(
      (r) =>
        `<li><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a></li>`
    )
    .join("");
  return `<div class="related-refs"><span class="related-label">Related reference documents</span><ul>${links}</ul></div>`;
}

function refMatches(ref) {
  if (state.topics.size && !(ref.topics || []).some((t) => state.topics.has(t)))
    return false;
  if (state.q) {
    const hay = `${ref.title} ${ref.description} ${ref.org}`.toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}

function refHTML(ref) {
  const year = ref.date ? ` · ${String(ref.date).slice(0, 4)}` : "";
  const topicTags = (ref.topics || [])
    .map((t) => `<span class="topic-tag">${esc(DATA.topics[t] || t)}</span>`)
    .join("");
  return `
  <article class="item regulatory ref-card">
    <div class="item-top">
      <span class="badge regulatory">${esc((ref.doc_type || "doc").toUpperCase())}</span>
      <span class="org">${esc(ref.org)}${year}</span>
    </div>
    <h3><a href="${esc(ref.url)}" target="_blank" rel="noopener">${esc(ref.title)}</a></h3>
    <p class="why">${esc(ref.description)}</p>
    <div class="topics">${topicTags}</div>
  </article>`;
}

function renderRefs() {
  const visible = DATA.references.filter(refMatches);
  const groups = [...new Set(visible.map((r) => r.group))];
  $("#refs").innerHTML = groups
    .map(
      (g) => `<section class="day-group">
        <div class="day-head">${esc(REF_GROUPS[g] || g)}</div>
        ${visible.filter((r) => r.group === g).map(refHTML).join("")}
      </section>`
    )
    .join("");
  $("#count").textContent = `${visible.length} reference document${visible.length === 1 ? "" : "s"}`;
  $("#empty").hidden = visible.length > 0;
}

function reviewHTML(item) {
  const r = item.reviews;
  if (!r) return "";
  const rows = [];
  if (r.quant)
    rows.push(row("Quant (PD/LGD models)", r.quant));
  if (r.regulatory)
    rows.push(row("Reg. expert (Nordic bank)", r.regulatory));
  return rows.length ? `<div class="reviews">${rows.join("")}</div>` : "";

  function row(who, rev) {
    return `<div class="review"><span class="who">${esc(who)}</span>
      <span class="rel ${esc(rev.relevance)}">${esc(rev.relevance.toUpperCase())}</span>
      <span class="say">“${esc(rev.verdict)}”</span></div>`;
  }
}

function itemHTML(item) {
  const low = isLowSignal(item);
  const topicTags = item.topics
    .map((t) => `<span class="topic-tag">${esc(DATA.topics[t] || t)}</span>`)
    .join("");
  return `
  <article class="item ${esc(item.author_type)}${low ? " low-signal" : ""}" data-id="${item.id}">
    <div class="item-top">
      <span class="badge ${esc(item.author_type)}">${item.author_type === "regulatory" ? "REGULATOR" : "COMMENTARY"}</span>
      <span class="org">${esc(item.source_name)}</span>
      <span class="pill ${esc(item.doc_status)}">${esc(STATUS_LABELS[item.doc_status] || item.doc_status)}</span>
      ${isNew(item) ? '<span class="newdot">● NEW</span>' : ""}
      <span class="item-date">${esc(itemDate(item))}</span>
    </div>
    <h3>${esc(item.title)}</h3>
    ${item.why_it_matters ? `<p class="why"><b>Why it matters:</b> ${esc(item.why_it_matters)}</p>` : ""}
    <div class="detail">
      <p>${esc(item.summary)}</p>
      <div class="topics">${topicTags}</div>
      ${reviewHTML(item)}
      ${relatedRefsHTML(item)}
      <a href="${esc(item.url)}" target="_blank" rel="noopener">Read at source →</a>
    </div>
  </article>`;
}

function render() {
  const view = state.view;
  const feed = view === "feed";
  $("#list").hidden = view !== "feed";
  $("#refs").hidden = view !== "refs";
  const quizEl = $("#quiz");
  if (quizEl) quizEl.hidden = view !== "quiz";
  const filters = document.querySelector(".filters");
  filters.classList.toggle("refs-mode", view === "refs");
  filters.classList.toggle("quiz-mode", view === "quiz");
  $("#count").hidden = view === "quiz";
  if (view === "quiz") {
    $("#empty").hidden = true;
    if (window.Quiz) window.Quiz.render(quizEl);
    return;
  }
  if (view === "refs") {
    renderRefs();
    return;
  }
  const visible = DATA.items.filter(
    (i) => matches(i) && (state.showLowSignal || !isLowSignal(i))
  );
  const lowHidden = DATA.items.filter((i) => matches(i) && isLowSignal(i)).length;
  $("#lowsig-label").textContent = `Show low-signal items (${lowHidden})`;

  // Group by day, reverse chronological.
  const groups = new Map();
  for (const item of visible) {
    const day = itemDate(item);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(item);
  }
  const days = [...groups.keys()].sort().reverse();

  $("#list").innerHTML = days
    .map(
      (day) => `<section class="day-group">
        <div class="day-head">${fmtDay(day)}</div>
        ${groups.get(day).map(itemHTML).join("")}
      </section>`
    )
    .join("");
  $("#count").textContent = `${visible.length} item${visible.length === 1 ? "" : "s"}`;
  $("#empty").hidden = visible.length > 0;
}

function buildFilters() {
  const orgs = [...new Set(DATA.items.map((i) => i.source_org))].sort();
  $("#f-org").innerHTML =
    '<option value="all">All sources</option>' +
    orgs.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("");

  const usedTopics = new Set(DATA.items.flatMap((i) => i.topics));
  $("#topic-chips").innerHTML = Object.entries(DATA.topics)
    .filter(([slug]) => usedTopics.has(slug))
    .map(([slug, label]) => `<button class="chip" data-topic="${esc(slug)}">${esc(label)}</button>`)
    .join("");
}

function wireEvents() {
  const tabs = { feed: $("#tab-feed"), refs: $("#tab-refs"), quiz: $("#tab-quiz") };
  for (const [view, btn] of Object.entries(tabs)) {
    if (!btn) continue;
    btn.addEventListener("click", () => {
      state.view = view;
      for (const [v, b] of Object.entries(tabs)) if (b) b.classList.toggle("on", v === view);
      render();
    });
  }
  $("#seg-author").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    state.authorType = btn.dataset.value;
    for (const b of $("#seg-author").children) b.classList.toggle("on", b === btn);
    render();
  });
  $("#f-org").addEventListener("change", (e) => { state.org = e.target.value; render(); });
  $("#f-status").addEventListener("change", (e) => { state.status = e.target.value; render(); });
  $("#f-persona").addEventListener("change", (e) => { state.persona = e.target.value; render(); });
  $("#f-search").addEventListener("input", (e) => {
    state.q = e.target.value.trim().toLowerCase(); render();
  });
  $("#f-lowsignal").addEventListener("change", (e) => {
    state.showLowSignal = e.target.checked; render();
  });
  $("#topic-chips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const slug = chip.dataset.topic;
    if (state.topics.has(slug)) state.topics.delete(slug);
    else state.topics.add(slug);
    chip.classList.toggle("on");
    render();
  });
  $("#list").addEventListener("click", (e) => {
    if (e.target.closest("a")) return; // let links work
    const el = e.target.closest(".item");
    if (el) el.classList.toggle("open");
  });
}

async function init() {
  const resp = await fetch("data/items.json");
  DATA = await resp.json();
  DATA.references = DATA.references || [];

  lastVisit = localStorage.getItem(LAST_VISIT_KEY);
  const newCount = DATA.items.filter(isNew).length;
  if (newCount > 0) {
    const banner = $("#new-banner");
    banner.textContent = `✨ ${newCount} new item${newCount === 1 ? "" : "s"} since your last visit (${new Date(lastVisit).toLocaleDateString("en-GB")}).`;
    banner.hidden = false;
  }
  localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());

  $("#meta").textContent = `Updated ${new Date(DATA.generated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  buildStats();
  buildFilters();
  wireEvents();
  render();
}

function buildStats() {
  const items = DATA.items;
  const reg = items.filter((i) => i.author_type === "regulatory").length;
  const dates = items
    .map((i) => (i.published_at || "").slice(0, 4))
    .filter(Boolean);
  const span = dates.length ? `${Math.min(...dates)}–${Math.max(...dates)}` : "—";
  const tiles = [
    { num: items.length, label: "Items tracked" },
    { num: reg, label: "Regulatory", cls: "reg" },
    { num: items.length - reg, label: "Commentary", cls: "com" },
    { num: DATA.sources.length, label: "Sources" },
    { num: span, label: "Coverage" },
  ];
  $("#stats").innerHTML = tiles
    .map(
      (t) => `<div class="stat ${t.cls || ""}">
        <span class="stat-num">${esc(t.num)}</span>
        <span class="stat-label">${esc(t.label)}</span>
      </div>`
    )
    .join("");
}

init().catch((err) => {
  $("#list").innerHTML = `<div class="empty">Failed to load data/items.json — ${esc(err.message)}</div>`;
});
