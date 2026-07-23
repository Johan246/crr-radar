/* CRR Radar — feedback widget. Talks to the serverless endpoint configured in
   window.CRR_FEEDBACK.endpoint (see feedback-config.js). Stateless: this widget
   holds the whole conversation and posts it back each turn. */
(function () {
  const CFG = window.CRR_FEEDBACK || {};
  const ENDPOINT = (CFG.endpoint || "").trim();

  const GREETING =
    "Hi, and thank you for helping improve CRR Radar! What's working well, " +
    "what's missing, or what would make this more useful for you?";

  const messages = []; // {role, content}
  let busy = false;
  let submitted = false;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c]);

  // ---- DOM ----------------------------------------------------------------
  const root = document.createElement("div");
  root.className = "fb-root";
  root.innerHTML = `
    <button class="fb-fab" aria-label="Send feedback" title="Send feedback">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 012 2v9a2 2 0 01-2 2H8l-4 4V6a2 2 0 012-2z"/></svg>
      <span>Feedback</span>
    </button>
    <section class="fb-panel" hidden aria-label="Feedback">
      <header class="fb-head">
        <div>
          <strong>Share feedback</strong>
          <span class="fb-sub">Help us improve CRR Radar</span>
        </div>
        <button class="fb-close" aria-label="Close">&times;</button>
      </header>
      <div class="fb-log" id="fb-log"></div>
      <div class="fb-composer">
        <input type="text" class="fb-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
        <textarea id="fb-input" rows="1" placeholder="Type your feedback…" aria-label="Your message"></textarea>
        <button class="fb-send" id="fb-send" aria-label="Send">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M3 11l18-8-8 18-2-7-8-3z"/></svg>
        </button>
      </div>
      <div class="fb-foot">
        <button class="fb-submit" id="fb-submit" disabled>Submit feedback &amp; send report</button>
      </div>
    </section>`;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  const fab = $(".fb-fab");
  const panel = $(".fb-panel");
  const log = $("#fb-log");
  const input = $("#fb-input");
  const sendBtn = $("#fb-send");
  const submitBtn = $("#fb-submit");
  const hp = $(".fb-hp");

  function bubble(role, text, cls) {
    const el = document.createElement("div");
    el.className = `fb-msg ${role}${cls ? " " + cls : ""}`;
    el.innerHTML = esc(text).replace(/\n/g, "<br>");
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function typing(on) {
    let t = log.querySelector(".fb-typing");
    if (on && !t) {
      t = document.createElement("div");
      t.className = "fb-msg assistant fb-typing";
      t.innerHTML = "<span></span><span></span><span></span>";
      log.appendChild(t);
      log.scrollTop = log.scrollHeight;
    } else if (!on && t) {
      t.remove();
    }
  }

  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b;
    input.disabled = b;
    submitBtn.disabled = b || submitted || messages.filter((m) => m.role === "user").length === 0;
  }

  async function post(payload) {
    if (!ENDPOINT) throw new Error("no-endpoint");
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text || busy || submitted) return;
    if (!ENDPOINT) {
      bubble("assistant", "The feedback service isn’t configured yet. Please try again later.", "fb-err");
      return;
    }
    input.value = "";
    input.style.height = "auto";
    messages.push({ role: "user", content: text });
    bubble("user", text);
    setBusy(true);
    typing(true);
    try {
      const data = await post({ mode: "chat", messages, hp: hp.value || undefined });
      typing(false);
      messages.push({ role: "assistant", content: data.reply });
      bubble("assistant", data.reply);
    } catch (err) {
      typing(false);
      bubble("assistant", errText(err), "fb-err");
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  async function submitReport() {
    if (busy || submitted || !messages.some((m) => m.role === "user")) return;
    setBusy(true);
    typing(true);
    try {
      const data = await post({ mode: "finalize", messages, hp: hp.value || undefined });
      typing(false);
      submitted = true;
      bubble("assistant", data.thank_you || "Thank you — your feedback has been recorded.", "fb-ok");
      input.placeholder = "Feedback submitted — thank you!";
      input.disabled = true;
      sendBtn.disabled = true;
      submitBtn.hidden = true;
    } catch (err) {
      typing(false);
      bubble("assistant", errText(err), "fb-err");
      setBusy(false);
    }
  }

  function errText(err) {
    if (String(err.message) === "no-endpoint")
      return "The feedback service isn’t configured yet.";
    return "Sorry — something went wrong sending that. Please try again in a moment.";
  }

  // ---- events -------------------------------------------------------------
  fab.addEventListener("click", () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    fab.classList.toggle("on", opening);
    if (opening && !log.childElementCount) {
      bubble("assistant", GREETING);
    }
    if (opening) setTimeout(() => input.focus(), 50);
  });
  $(".fb-close").addEventListener("click", () => {
    panel.hidden = true;
    fab.classList.remove("on");
  });
  sendBtn.addEventListener("click", sendMessage);
  submitBtn.addEventListener("click", submitReport);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 120) + "px";
    submitBtn.disabled = busy || submitted || !messages.some((m) => m.role === "user");
  });
})();
