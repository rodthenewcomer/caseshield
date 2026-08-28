/**
 * Validation dashboard client.
 *
 * Built with createElement/textContent only — never HTML strings — so it
 * holds the same strict-CSP and injection-safety bar as the public site.
 */

const STORAGE_KEY = "caseshield_validation_token";

const $ = (id) => document.getElementById(id);

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function label(name) {
  const words = String(name).replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function pct(value) {
  return value === null || value === undefined ? "—" : `${value}%`;
}

/** "none" is the stored placeholder for an absent campaign dimension. */
function dim(value) {
  return !value || value === "none" ? "—" : value;
}

function setStatus(message) {
  $("statusText").textContent = message;
  $("status").hidden = !message;
}

function card(title, value, note, variant) {
  const node = element("div", variant ? `card ${variant}` : "card");
  node.append(element("span", null, title), element("strong", null, value));
  if (note) node.append(element("small", null, note));
  return node;
}

function row(cells) {
  const tr = document.createElement("tr");
  for (const cell of cells) {
    tr.append(
      element("td", cell.className, cell.text),
    );
  }
  return tr;
}

function renderHeadline(data) {
  const h = data.headline;
  $("wtpDefinition").textContent =
    "Sessions that completed a case check AND signalled $29 intent, divided by sessions that completed a case check.";

  $("headline").replaceChildren(
    card(
      "Qualified WTP",
      pct(h.qualified_wtp_pct),
      "Completers who want to pay",
      "key",
    ),
    card("Completions", h.completions, "Finished the 5-step check"),
    card("Qualified intents", h.qualified_intents, "Completed, then clicked $29"),
    card(
      "Unqualified intents",
      h.unqualified_intents,
      "Clicked $29 without completing — real interest, excluded from the KPI",
    ),
    card("Sessions", data.sessions, "Unique anonymous visitors"),
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

function renderCore(steps) {
  const body = $("coreRows");
  body.replaceChildren();
  const drop = worstDropIndex(steps);

  steps.forEach((step, index) => {
    const name =
      index === drop ? `${label(step.name)}  ← biggest drop` : label(step.name);
    const tr = row([
      { text: name },
      {
        text: step.unique_sessions,
        className: step.unique_sessions ? "num" : "num zero",
      },
      { text: step.total_events, className: "num" },
      { text: pct(step.reach_pct), className: "num" },
      { text: pct(step.step_pct), className: "num" },
    ]);
    if (index === drop) tr.className = "drop";
    body.append(tr);
  });
}

function renderActions(actions) {
  const body = $("actionRows");
  body.replaceChildren();

  for (const [name, stats] of Object.entries(actions)) {
    body.append(
      row([
        { text: label(name) },
        {
          text: stats.sessions,
          className: stats.sessions ? "num" : "num zero",
        },
        { text: pct(stats.pct), className: "num" },
        { text: stats.all_sessions, className: "num" },
      ]),
    );
  }
}

function renderCampaigns(campaigns) {
  const body = $("campaignRows");
  body.replaceChildren();

  if (!campaigns.length) {
    const tr = document.createElement("tr");
    const td = element("td", "zero", "No sessions recorded yet.");
    td.colSpan = 11;
    tr.append(td);
    body.append(tr);
    return;
  }

  for (const campaign of campaigns) {
    const tr = row([
      { text: campaign.unattributed ? "direct / unattributed" : dim(campaign.utm_source) },
      { text: dim(campaign.utm_medium) },
      { text: dim(campaign.utm_campaign) },
      { text: dim(campaign.utm_content) },
      { text: dim(campaign.utm_term) },
      { text: campaign.sessions, className: "num" },
      { text: campaign.case_starts, className: "num" },
      { text: campaign.completions, className: "num" },
      { text: pct(campaign.completion_pct), className: "num" },
      { text: campaign.qualified_intents, className: "num" },
      { text: pct(campaign.qualified_wtp_pct), className: "num" },
    ]);
    if (campaign.unattributed) tr.className = "zero";
    body.append(tr);
  }
}

function renderAnswers(answers) {
  const target = $("answers");
  target.replaceChildren();

  const fields = Object.keys(answers).filter(
    (field) => (answers[field] || []).length,
  );
  if (!fields.length) {
    target.append(element("p", "sub", "No assessment answers recorded yet."));
    return;
  }

  for (const field of fields) {
    target.append(element("h3", "h3", label(field)));
    const cards = element("div", "cards");
    for (const entry of answers[field].slice(0, 6)) {
      cards.append(card(entry.value, entry.sessions, "unique sessions"));
    }
    target.append(cards);
  }
}

/**
 * Operator context. Reading a Preview dashboard while believing it is
 * Production would be an expensive mistake, so the environment is always
 * stated, along with a fingerprint that reveals when two environments share
 * one store.
 */
function renderEnvironment(environment) {
  const banner = $("envBanner");
  if (!environment) {
    banner.hidden = true;
    return;
  }

  const parts = [`Environment: ${environment.label}`];
  if (environment.store_fingerprint) {
    parts.push(`store ${environment.store_fingerprint}`);
  }
  const line = $("envLine");
  line.textContent = parts.join(" · ");
  line.className = `env ${environment.slug === "prod" ? "prod" : "nonprod"}`;

  const warnings = $("envWarnings");
  warnings.replaceChildren();
  for (const warning of environment.warnings || []) {
    warnings.append(element("p", "warn", warning));
  }

  banner.hidden = false;
}

function render(data) {
  renderEnvironment(data.environment);

  if (!data.configured) {
    setStatus(
      "Connected, but no event store is configured. Set KV_REST_API_URL and KV_REST_API_TOKEN on the project, then redeploy.",
    );
  } else if (!data.sessions) {
    setStatus("Store is live and empty — no sessions recorded yet.");
  } else {
    setStatus("");
  }

  const sample = $("sample");
  sample.textContent = data.sample ? data.sample.note : "";
  sample.className = `sample ${data.sample ? data.sample.label : ""}`;

  renderHeadline(data);
  renderCore(data.core || []);
  renderActions(data.actions || {});
  renderCampaigns(data.campaigns || []);
  renderAnswers(data.answers || {});
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
