import { createCasePlan } from "/intelligence.js";
import {
  attributionPayload,
  heroVariant,
  isInternalTraffic,
} from "/acquisition.js";

(() => {
  const SESSION_KEY = "caseshield_validation_id";
  const state = { step: 0, answers: {}, completed: false, started: false };
  const steps = [
    {
      id: "event",
      title: "What happened to your case?",
      sub: "Choose the event that best describes the uncertainty you are dealing with.",
      choices: [
        [
          "Interview cancelled",
          "Your scheduled appointment was cancelled",
          "calendar-x",
        ],
        ["Interview rescheduled", "You received a different date", "calendar"],
        [
          "No replacement date",
          "Your interview changed and no new date arrived",
          "clock",
        ],
        ["221(g)", "Additional processing or documents requested", "document"],
        [
          "Administrative processing",
          "Your case is under additional review",
          "search",
        ],
        ["NVC delay", "You are waiting for interview scheduling", "hourglass"],
        [
          "Medical / document expiry concern",
          "A time-sensitive document may expire",
          "alert",
        ],
        ["Something else", "Another immigration case disruption", "more"],
      ],
    },
    {
      id: "visa",
      title: "What visa are you pursuing?",
      sub: "This helps separate patterns that can differ by visa category.",
      choices: [
        ["CR1 / IR1 spouse", "Spouse immigrant visa", "heart"],
        ["F2A", "Spouse or child of a permanent resident", "family"],
        ["IR5 parent", "Parent of a U.S. citizen", "people"],
        ["K1 fiancé(e)", "Fiancé(e) visa", "ring"],
        [
          "Employment immigrant visa",
          "Employment-based immigrant visa",
          "briefcase",
        ],
        ["Diversity visa", "Diversity Visa program", "globe"],
        ["Other", "Another immigrant visa category", "more"],
      ],
    },
    {
      id: "embassy",
      title: "Where is your interview being handled?",
      sub: "City or embassy name is enough. Do not enter a case number or personal identifier.",
      input: true,
    },
    {
      id: "timing",
      title: "Where are you in the process?",
      sub: "Timing changes what should be watched first.",
      choices: [
        ["Interview within 7 days", "Very time-sensitive", "bolt"],
        ["Interview within 30 days", "Upcoming interview", "calendar"],
        [
          "Interview already cancelled",
          "Disruption already occurred",
          "calendar-x",
        ],
        ["Waiting for new date", "No replacement appointment yet", "clock"],
        [
          "No interview scheduled yet",
          "Still waiting in the scheduling process",
          "hourglass",
        ],
      ],
    },
    {
      id: "need",
      title: "What matters most right now?",
      sub: "This tells us which outcome is valuable enough to build around.",
      choices: [
        ["Knowing when interviews resume", "Track embassy movement", "pulse"],
        [
          "Seeing whether applicants like me received new dates",
          "Community rescheduling intelligence",
          "people",
        ],
        [
          "Protecting medical / document validity",
          "Watch time-sensitive expirations",
          "shield",
        ],
        [
          "Understanding what policy changed",
          "Clear official-source context",
          "document",
        ],
        [
          "Knowing when I should seek professional help",
          "Escalation signals, not legal advice",
          "help",
        ],
      ],
    },
  ];

  /**
   * Local SVG icon system. Unicode symbols read as a coded prototype; these
   * are drawn as consistent 24x24 stroke paths, styled through currentColor
   * so they inherit state colours without inline styles (strict CSP).
   */
  const SVG_NS = "http://www.w3.org/2000/svg";
  const ICON_PATHS = {
    calendar: [
      "M4 5h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z",
      "M3 10h18",
      "M8 3v4",
      "M16 3v4",
    ],
    "calendar-x": [
      "M4 5h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z",
      "M3 10h18",
      "M8 3v4",
      "M16 3v4",
      "M10 14l4 4",
      "M14 14l-4 4",
    ],
    clock: ["M12 21a9 9 0 100-18 9 9 0 000 18z", "M12 7.5V12l3 2"],
    document: [
      "M14 3H7a1 1 0 00-1 1v16a1 1 0 001 1h10a1 1 0 001-1V7z",
      "M14 3v4h4",
      "M9 13h6",
      "M9 17h4",
    ],
    search: ["M11 19a8 8 0 100-16 8 8 0 000 16z", "M21 21l-4.3-4.3"],
    hourglass: [
      "M7 3h10",
      "M7 21h10",
      "M17 3v4l-5 5 5 5v4",
      "M7 3v4l5 5-5 5v4",
    ],
    alert: [
      "M10.3 4.3L2.6 18a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z",
      "M12 9.5v4",
      "M12 17.5h.01",
    ],
    more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
    heart: ["M12 20s-7-4.4-7-9.4A4 4 0 0112 7.2 4 4 0 0119 10.6c0 5-7 9.4-7 9.4z"],
    family: [
      "M8.5 11a3 3 0 100-6 3 3 0 000 6z",
      "M2.5 20c0-3.3 2.7-6 6-6s6 2.7 6 6",
      "M16 6.2a3 3 0 010 5.6",
      "M17.5 14.2c2.4.5 4 2.6 4 5.8",
    ],
    people: [
      "M12 11.5a4 4 0 100-8 4 4 0 000 8z",
      "M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8",
    ],
    ring: ["M12 21a7 7 0 100-14 7 7 0 000 14z", "M9 7.4L12 3l3 4.4"],
    briefcase: [
      "M4 8h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z",
      "M9 8V5.5a1 1 0 011-1h4a1 1 0 011 1V8",
      "M3 13h18",
    ],
    globe: [
      "M12 21a9 9 0 100-18 9 9 0 000 18z",
      "M3 12h18",
      "M12 3a14 14 0 000 18 14 14 0 000-18",
    ],
    bolt: ["M13 2.5L4.5 14H11l-1 7.5L19.5 10H13z"],
    pulse: ["M3 12h3.8L9 5.5l4 13 2.2-6.5H21"],
    shield: ["M12 3l8 3v6c0 5-3.4 8.2-8 9.2C7.4 20.2 4 17 4 12V6z"],
    help: [
      "M12 21a9 9 0 100-18 9 9 0 000 18z",
      "M9.6 9.2a2.5 2.5 0 014.9.6c0 1.7-2.5 2-2.5 3.8",
      "M12 17.2h.01",
    ],
  };

  function iconNode(name) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const definition of ICON_PATHS[name] || ICON_PATHS.more) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", definition);
      svg.append(path);
    }
    return svg;
  }

  const $ = (id) => document.getElementById(id);
  const assessmentShell = $("assessmentShell");
  const stage = $("assessmentStage");
  const snapshot = $("snapshot");
  const mobileCta = $("mobileCta");
  let lastFocusedElement = null;

  document.documentElement.classList.add("motion-ready");

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function getSessionId() {
    try {
      let id = localStorage.getItem(SESSION_KEY);
      if (!id) {
        id =
          globalThis.crypto?.randomUUID?.() ||
          `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (_error) {
      return globalThis.crypto?.randomUUID?.() || `ephemeral-${Date.now()}`;
    }
  }

  // Resolved once per page load so the flag cannot change mid-session.
  const internalTraffic = isInternalTraffic();

  async function track(name, meta = {}) {
    if (internalTraffic) return;

    const payload = {
      name,
      session_id: getSessionId(),
      ...attributionPayload(),
      ...meta,
    };
    try {
      await fetch("/api/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: "same-origin",
      });
    } catch (_error) {
      // Analytics must never block the product-validation flow.
    }
  }

  function safe(value) {
    return String(value || "")
      .replace(/[<>\r\n]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 90);
  }

  function sanitizeAnswers(answers) {
    return {
      event: safe(answers.event),
      visa: safe(answers.visa),
      embassy: safe(answers.embassy),
      timing: safe(answers.timing),
      need: safe(answers.need),
    };
  }

  function setMobileCtaHidden(hidden) {
    mobileCta?.classList.toggle("hidden", hidden);
  }

  /**
   * The sticky CTA previously vanished past an arbitrary 500px of scroll, so
   * a visitor simply reading the page on a phone lost the primary action. It
   * now hides only once the assessment is genuinely on screen, or once the
   * visitor has actually started it.
   */
  if (mobileCta && "IntersectionObserver" in window) {
    const checkObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setMobileCtaHidden(entry.isIntersecting || state.started);
        });
      },
      { threshold: 0.3 },
    );
    checkObserver.observe($("check"));
  }

  function markStarted() {
    if (state.started) return;
    state.started = true;
    setMobileCtaHidden(true);
    track("case_check_started");
  }

  function scrollToCheck(source) {
    // Intent to begin only. case_check_started fires on the first real
    // interaction with a question, so the two metrics stay distinguishable.
    renderStep();
    track("hero_cta_click", { source });
    $("check").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.querySelectorAll("[data-scroll-check]").forEach((control) => {
    control.addEventListener("click", () => scrollToCheck("nav_or_mobile"));
  });
  $("heroCta").addEventListener("click", () => scrollToCheck("hero"));

  function createAssessmentError() {
    const error = element("p", "assessment-error");
    error.id = "assessmentError";
    error.setAttribute("role", "alert");
    error.setAttribute("aria-live", "polite");
    return error;
  }

  function showAssessmentError(step) {
    const message = step.input
      ? "Enter an embassy or city to continue."
      : "Choose one option to continue.";
    $("assessmentError").textContent = message;
    const target = step.input
      ? $("embassyInput")
      : stage.querySelector(".choices");
    target?.classList.add("has-error");
    target?.focus?.();
  }

  function renderStep() {
    const step = steps[state.step];
    const saved = state.answers[step.id] || "";
    $("stepLabel").textContent = `Step ${state.step + 1} of ${steps.length}`;
    $("progressFill").className = `progress-fill progress-${state.step + 1}`;

    const wrapper = element("div", "assessment-step");
    const heading = element("h3", "", step.title);
    heading.id = "assessmentQuestion";
    heading.tabIndex = -1;
    wrapper.append(heading, element("p", "", step.sub));

    if (step.input) {
      const searchBox = element("div", "search-box");
      const input = element("input", "search-input");
      input.id = "embassyInput";
      input.type = "text";
      input.maxLength = 80;
      input.autocomplete = "off";
      input.placeholder = "Embassy or city — no case number";
      input.value = saved;
      input.setAttribute("aria-label", "Embassy or city");
      input.setAttribute("aria-describedby", "assessmentError");
      const searchIcon = element("span", "search-icon", "⌕");
      searchIcon.setAttribute("aria-hidden", "true");
      searchBox.append(input, searchIcon);

      const suggestions = element("div", "suggestions");
      suggestions.setAttribute("aria-label", "Popular embassy examples");
      ["Mumbai", "Manila", "London", "Abidjan", "Ciudad Juárez"].forEach(
        (name) => {
          const button = element("button", "suggestion", name);
          button.type = "button";
          button.addEventListener("click", () => {
            markStarted();
            input.value = name;
            state.answers.embassy = name;
            $("assessmentError").textContent = "";
            input.focus();
          });
          suggestions.append(button);
        },
      );
      input.addEventListener("input", (event) => {
        markStarted();
        state.answers.embassy = event.target.value.trim();
        $("assessmentError").textContent = "";
        input.classList.remove("has-error");
      });
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          nextStep();
        }
      });
      wrapper.append(searchBox, suggestions);
    } else {
      const choices = element("div", "choices");
      choices.tabIndex = -1;
      choices.setAttribute("role", "group");
      choices.setAttribute("aria-labelledby", heading.id);
      step.choices.forEach(([label, description, icon]) => {
        const button = element(
          "button",
          `choice-card${saved === label ? " selected" : ""}`,
        );
        button.type = "button";
        button.dataset.choice = label;
        button.setAttribute("aria-pressed", String(saved === label));
        const iconWrap = element("span", "choice-icon");
        iconWrap.setAttribute("aria-hidden", "true");
        iconWrap.append(iconNode(icon));
        const copy = element("span", "choice-text");
        copy.append(
          element("strong", "", label),
          element("small", "", description),
        );
        button.append(iconWrap, copy);
        button.addEventListener("click", () => {
          markStarted();
          state.answers[step.id] = label;
          choices.classList.remove("has-error");
          $("assessmentError").textContent = "";
          choices.querySelectorAll(".choice-card").forEach((choice) => {
            const selected = choice === button;
            choice.classList.toggle("selected", selected);
            choice.setAttribute("aria-pressed", String(selected));
          });
        });
        choices.append(button);
      });
      wrapper.append(choices);
    }

    wrapper.append(createAssessmentError());
    const navigation = element("div", "assessment-nav");
    const back = element("button", "btn btn-subtle", "Back");
    back.id = "backBtn";
    back.type = "button";
    back.disabled = state.step === 0;
    back.addEventListener("click", () => {
      if (state.step === 0) return;
      state.step -= 1;
      renderStep();
      $("assessmentQuestion").focus({ preventScroll: true });
    });
    const next = element("button", "btn btn-primary");
    next.id = "nextBtn";
    next.type = "button";
    next.textContent =
      state.step === steps.length - 1
        ? "Show my monitoring plan →"
        : "Continue →";
    next.addEventListener("click", nextStep);
    navigation.append(back, next);
    wrapper.append(navigation);
    stage.replaceChildren(wrapper);
  }

  function nextStep() {
    markStarted();
    const step = steps[state.step];
    const value = step.input
      ? $("embassyInput")?.value.trim() || ""
      : state.answers[step.id];
    if (!value) {
      showAssessmentError(step);
      return;
    }
    if (step.input && /\d{5,}/.test(value)) {
      $("assessmentError").textContent =
        "For privacy, enter only the embassy or city — never a case number.";
      $("embassyInput").classList.add("has-error");
      $("embassyInput").focus();
      return;
    }
    state.answers[step.id] = value;
    track(`case_step_${state.step + 1}`, {
      answer: safe(value),
      step_id: step.id,
    });
    if (state.step < steps.length - 1) {
      state.step += 1;
      renderStep();
      $("assessmentQuestion").focus({ preventScroll: true });
      return;
    }
    completeAssessment();
  }

  function setSnapshotStatus(label) {
    const status = $("snapshotStatus");
    const dot = element("span");
    dot.setAttribute("aria-hidden", "true");
    status.replaceChildren(dot, document.createTextNode(label));
  }

  function completeAssessment() {
    state.completed = true;
    const answers = sanitizeAnswers(state.answers);
    const plan = createCasePlan(answers);
    track("case_check_completed", answers);
    assessmentShell.hidden = true;

    const context = [answers.visa, answers.embassy, answers.event].filter(
      Boolean,
    );
    $("snapshotContext").replaceChildren(
      ...context.map((value) => element("span", "context-chip", value)),
    );
    $("snapshotTitle").textContent = plan.title;
    setSnapshotStatus(plan.status);
    $("snapshotWatch").textContent = plan.watch;
    $("snapshotSource").textContent = plan.source;
    $("snapshotRisk").textContent = plan.risk;
    $("snapshotEscalation").textContent = plan.escalation;
    $("snapshotNote").textContent = plan.note;
    $("alertSuccess").hidden = true;
    $("alertIntent").disabled = false;
    snapshot.hidden = false;
    snapshot.scrollIntoView({ behavior: "smooth", block: "center" });
    $("snapshotTitle").focus?.({ preventScroll: true });
    setMobileCtaHidden(true);
  }

  $("resetAssessment").addEventListener("click", () => {
    state.step = 0;
    state.answers = {};
    state.completed = false;
    state.started = false;
    assessmentShell.hidden = false;
    snapshot.hidden = true;
    renderStep();
    $("assessmentQuestion").focus({ preventScroll: true });
  });

  // Bridges the aha moment to the offer without pushing it: this records
  // interest and scrolls, but must never imply purchase intent by itself.
  $("resultOfferLink")?.addEventListener("click", () => {
    track("result_offer_click", sanitizeAnswers(state.answers));
    $("pricing").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("alertIntent").addEventListener("click", () => {
    track("alert_intent", sanitizeAnswers(state.answers));
    $("alertSuccess").hidden = false;
    $("alertIntent").disabled = true;
  });

  if ("IntersectionObserver" in window) {
    const offerObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !offerObserver.seen) {
            offerObserver.seen = true;
            track("pricing_view");
          }
        });
      },
      { threshold: 0.55 },
    );
    offerObserver.observe($("offerCard"));
  }

  function openModal() {
    lastFocusedElement = document.activeElement;
    $("purchaseModal").hidden = false;
    document.body.classList.add("modal-open");
    requestAnimationFrame(() => $("modalClose").focus());
  }

  function closeModal() {
    $("purchaseModal").hidden = true;
    document.body.classList.remove("modal-open");
    lastFocusedElement?.focus?.();
  }

  $("purchaseIntent").addEventListener("click", () => {
    track("purchase_intent_29", sanitizeAnswers(state.answers));
    openModal();
  });
  $("modalClose").addEventListener("click", closeModal);
  $("modalDone").addEventListener("click", closeModal);
  $("purchaseModal").addEventListener("click", (event) => {
    if (event.target === $("purchaseModal")) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if ($("purchaseModal").hidden) return;
    if (event.key === "Escape") {
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [$("modalClose"), $("modalDone")];
    const currentIndex = focusable.indexOf(document.activeElement);
    const nextIndex = event.shiftKey
      ? (currentIndex - 1 + focusable.length) % focusable.length
      : (currentIndex + 1) % focusable.length;
    event.preventDefault();
    focusable[nextIndex].focus();
  });

  const revealElements = document.querySelectorAll(".reveal:not(.is-visible)");
  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px 8% 0px" },
    );
    revealElements.forEach((item) => revealObserver.observe(item));
  } else {
    revealElements.forEach((item) => item.classList.add("is-visible"));
  }

  /**
   * Paid-search message match. Copy is chosen from a fixed map keyed by a
   * trusted enum — arbitrary UTM text is never rendered, so a crafted ad URL
   * cannot put words on the page.
   */
  const HERO_MATCH_COPY = {
    cancelled:
      "Interview cancelled? Build a monitoring plan around what actually changed.",
    rescheduled:
      "Interview moved? Check what now needs watching before the new date.",
    no_date:
      "Still waiting for a replacement date? Organize what to watch next.",
    nvc_delay:
      "Waiting on NVC scheduling? Build a clear monitoring plan meanwhile.",
  };

  function applyHeroMatch() {
    const variant = heroVariant();
    const copy = variant ? HERO_MATCH_COPY[variant] : null;
    const slot = $("heroMatch");
    if (!slot || !copy) return;
    slot.textContent = copy;
    slot.hidden = false;
  }

  function updateScrollState() {
    $("siteHeader").classList.toggle("scrolled", window.scrollY > 24);
  }

  window.addEventListener("scroll", updateScrollState, { passive: true });
  applyHeroMatch();
  renderStep();
  updateScrollState();
  track("page_view");
})();
