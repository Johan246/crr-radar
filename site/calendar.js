/* CRR Radar — Regulatory calendar. Static, client-side. Shows CRR3 / output-floor
   / transitional / Swedish Article 458 milestones as a dated timeline with
   countdowns. Data: data/deadlines.json (grounded, dated milestones only). */
window.Cal = (function () {
  let DATA = null;
  let container = null;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);

  const CAT = {
    "crr3": "CRR3",
    "output-floor": "Output floor",
    "transitional": "Transitional",
    "national-se": "Sweden · Art. 458",
    "supervisory": "Supervisory",
  };

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function parseDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  function daysBetween(target, now) {
    return Math.round((target - now) / 86400000);
  }

  function awayLabel(days) {
    if (days === 0) return "today";
    if (days < 0) {
      const a = -days;
      if (a < 60) return `${a}d ago`;
      const mo = Math.round(a / 30.44);
      if (mo < 24) return `${mo}mo ago`;
      return `${(a / 365).toFixed(1)}y ago`;
    }
    if (days < 60) return `in ${days}d`;
    const mo = Math.round(days / 30.44);
    if (mo < 24) return `in ~${mo}mo`;
    return `in ~${(days / 365).toFixed(1)}y`;
  }

  async function ensureData() {
    if (DATA) return;
    const resp = await fetch("data/deadlines.json");
    DATA = await resp.json();
  }

  async function render(el) {
    if (el) container = el;
    if (!container) return;
    if (!DATA) {
      container.innerHTML = `<div class="cal-loading">Loading…</div>`;
      await ensureData();
    }
    draw();
  }

  function rowHTML(d, now) {
    const dt = parseDate(d.date);
    const days = daysBetween(dt, now);
    const past = days < 0;
    const dd = dt.getUTCDate();
    const label = CAT[d.category] || d.category;
    return `<li class="cal-row ${past ? "past" : "upcoming"}">
      <div class="cal-date">
        <span class="cal-d">${dd} ${MONTHS[dt.getUTCMonth()]}</span>
        <span class="cal-y">${dt.getUTCFullYear()}</span>
      </div>
      <div class="cal-body">
        <div class="cal-top">
          <span class="cal-cat cat-${esc(d.category)}">${esc(label)}</span>
          <span class="cal-away ${past ? "" : days < 120 ? "soon" : ""}">${awayLabel(days)}</span>
        </div>
        <h4>${esc(d.title)}</h4>
        ${d.note ? `<p class="cal-note">${esc(d.note)}</p>` : ""}
        ${d.legal_basis ? `<span class="cal-basis">${esc(d.legal_basis)}</span>` : ""}
      </div>
    </li>`;
  }

  function draw() {
    const now = new Date();
    const todayUTC = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const all = (DATA.deadlines || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const upcoming = all.filter((d) => parseDate(d.date) >= todayUTC);
    const past = all.filter((d) => parseDate(d.date) < todayUTC).reverse();

    const next = upcoming[0];
    const nextLine = next
      ? `Next: <strong>${esc(next.title)}</strong> — ${awayLabel(daysBetween(parseDate(next.date), todayUTC))}.`
      : "No upcoming milestones on file.";

    container.innerHTML = `
      <div class="cal-intro">
        <h2>Regulatory calendar</h2>
        <p class="cal-lede">Key CRR3 application dates, the output-floor phase-in ladder,
          transitional expiries, and Swedish Article&nbsp;458 measures. ${nextLine}</p>
      </div>

      <div class="cal-section-h">Upcoming (${upcoming.length})</div>
      <ol class="cal-list">${upcoming.map((d) => rowHTML(d, todayUTC)).join("") || '<li class="cal-empty">Nothing upcoming.</li>'}</ol>

      ${
        past.length
          ? `<div class="cal-section-h">Passed (${past.length})</div>
             <ol class="cal-list cal-past">${past.map((d) => rowHTML(d, todayUTC)).join("")}</ol>`
          : ""
      }

      <p class="cal-disclaimer">Dates are grounded in a research brief (23 July 2026 cut-off) and
        subject to change — verify against the consolidated CRR on EUR-Lex and current
        Finansinspektionen / EBA material. Transitional measures may be extended.</p>`;
  }

  return { render };
})();
