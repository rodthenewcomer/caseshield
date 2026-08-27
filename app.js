import { createCasePlan } from "/intelligence.js";

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

  const icons = {
    "calendar-x": "✕",
    calendar: "▣",
    clock: "◷",
    document: "▤",
    search: "⌕",
    hourglass: "⌛",
    alert: "!",
    more: "···",
    heart: "♡",
    family: "◉",
    people: "◌",
    ring: "◇",
    briefcase: "▱",
    globe: "◎",
    bolt: "ϟ",
    pulse: "⌁",
    shield: "♢",
    help: "?",
  };

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

  async function track(name, meta = {}) {
    const payload = { name, session_id: getSessionId(), ...meta };
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

  function markStarted() {
    if (state.started) return;
    state.started = true;
    track("case_check_started");
  }

  function scrollToCheck(source) {
    markStarted();
    renderStep();
    track("hero_cta_click", { source });
    $("check").scrollIntoView({ behavior: "smooth", block: "start" });
    mobileCta?.classList.add("hidden");
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
        const iconNode = element("span", "choice-icon", icons[icon] || "•");
        iconNode.setAttribute("aria-hidden", "true");
        const copy = element("span", "choice-text");
        copy.append(
          element("strong", "", label),
          element("small", "", description),
        );
        button.append(iconNode, copy);
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
    mobileCta?.classList.add("hidden");
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

  function updateScrollState() {
    $("siteHeader").classList.toggle("scrolled", window.scrollY > 24);
    if (mobileCta)
      mobileCta.classList.toggle(
        "hidden",
        window.scrollY > 500 || state.started,
      );
  }

  window.addEventListener("scroll", updateScrollState, { passive: true });
  renderStep();
  updateScrollState();
  track("page_view");
})();
