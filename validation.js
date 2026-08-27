/**
 * Validation dashboard client.
 *
 * Built with createElement/textContent only — never HTML strings — so it
 * holds the same strict-CSP and injection-safety bar as the public site.
 */

const STORAGE_KEY = "caseshield_validation_token";
const SEGMENT_FIELDS = ["visa", "timing", "need", "embassy"];

const $ = (id) => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function label(name) {
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function pct(value) {
  return value === null || value === undefined ? "—" : `${value}%`;
}

function setStatus(message) {
  const panel = $("status");
  $("statusText").textContent = message;
  panel.hidden = !message;
}

function card(title, value, note, isKey) {
  const node = element("div", isKey ? "card key" : "card");
  node.append(element("span", null, title), element("strong", null, value));
  if (note) node.append(element("small", null, note));
  return node;
}

function renderHeadline(data) {
  const target = $("headline");
  target.replaceChildren();

  const h = data.headline;
  target.append(
    card("Sessions", data.sessions, "Unique anonymous visitors"),
    card("Completions", h.completions, "Finished the 5-step check"),
    card("Alert intent", h.alert_intents, "Asked to be monitored"),
    card(
      "Completion → $29 intent",
      pct(h.completion_to_intent_pct),
      "The kill-or-continue signal",
      true,
    ),
  );
}

/** Largest single drop between consecutive stages, which is where to act. */
function worstDropIndex(steps) {
  let worstIndex = -1;
  let worstValue = Infinity;
  steps.forEach((step, index) => {
    if (index === 0 || step.step_pct === null) return;
    if (steps[index - 1].unique_sessions < 5) return;
    if (step.step_pct < worstValue) {
      worstValue = step.step_pct;
      worstIndex = index;
    }
  });
  return worstIndex;
}

function renderTable(steps) {
  const body = $("rows");
  body.replaceChildren();
  const drop = worstDropIndex(steps);

  steps.forEach((step, index) => {
    const row = element("tr", index === drop ? "drop" : null);
    const name = element("td", null, label(step.name));
    if (index === drop) name.textContent += "  ← biggest drop";
    row.append(
      name,
      element(
        "td",
        step.unique_sessions ? "num" : "num zero",
        step.unique_sessions,
      ),
      element("td", "num", step.total_events),
      element("td", "num", pct(step.reach_pct)),
      element("td", "num", pct(step.step_pct)),
    );
    body.append(row);
  });
}

function renderSegments(recent) {
  const target = $("segments");
  target.replaceChildren();

  if (!recent.length) {
    target.append(
      card("No sampled answers yet", "—", "Recent events appear here"),
    );
    return;
  }

  for (const field of SEGMENT_FIELDS) {
    const counts = new Map();
    for (const event of recent) {
      const value = event?.[field];
      if (!value || value === "[redacted]") continue;
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    if (!counts.size) continue;

    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [topValue, topCount] = ranked[0];
    const others = ranked
      .slice(1, 3)
      .map(([value, count]) => `${value} (${count})`)
      .join(", ");
    target.append(
      card(field, `${topValue} · ${topCount}`, others || "Only value seen"),
    );
  }
}

function render(data) {
  if (!data.configured) {
    setStatus(
      "Connected, but no event store is configured yet. Set KV_REST_API_URL and KV_REST_API_TOKEN on the project, then redeploy.",
    );
  } else if (!data.sessions) {
    setStatus("Store is live and empty — no sessions recorded yet.");
  } else {
    setStatus("");
  }

  renderHeadline(data);
  renderTable(data.steps);
  renderSegments(data.recent || []);
  $("results").hidden = false;
}

async function load(token) {
  setStatus("Loading…");
  let response;
  try {
    response = await fetch("/api/validation", {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    setStatus("Network error reaching the validation API.");
    return;
  }

  if (response.status === 401) {
    sessionStorage.removeItem(STORAGE_KEY);
    setStatus("That token was rejected.");
    return;
  }
  if (response.status === 503) {
    setStatus(
      "Dashboard is not configured: VALIDATION_TOKEN is unset on the project.",
    );
    return;
  }
  if (!response.ok) {
    setStatus(`Could not read the funnel (HTTP ${response.status}).`);
    return;
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Private-mode browsers simply re-prompt next visit.
  }
  render(await response.json());
}

function init() {
  $("load").addEventListener("click", () => {
    const token = $("token").value.trim();
    if (token) load(token);
  });

  $("token").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("load").click();
  });

  let saved = "";
  try {
    saved = sessionStorage.getItem(STORAGE_KEY) || "";
  } catch {
    saved = "";
  }
  if (saved) {
    $("token").value = saved;
    load(saved);
  }
}

init();
