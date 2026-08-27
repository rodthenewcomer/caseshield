const EVENT_PLANS = {
  "Interview cancelled": {
    title: "Cancelled interview monitoring plan",
    watch:
      "A written cancellation reason, replacement-date instructions and appointment-portal changes",
    source:
      "The issuing post’s official notice, direct email and authorized appointment portal",
    risk: "Medical, police-certificate, passport and time-limited document validity",
    escalation:
      "Official instructions conflict, a deadline is unclear or the cancellation creates a case-specific legal issue",
  },
  "Interview rescheduled": {
    title: "Rescheduled interview monitoring plan",
    watch:
      "Whether the new date is confirmed consistently across the notice and appointment portal",
    source:
      "The issuing post’s written rescheduling notice and authorized appointment portal",
    risk: "Whether the new date falls inside medical, passport and document validity windows",
    escalation:
      "The new date conflicts with written instructions or creates a legal or eligibility question",
  },
  "No replacement date": {
    title: "Replacement-date monitoring plan",
    watch:
      "Official rescheduling instructions and embassy-specific appointment movement",
    source:
      "The issuing post’s official updates, direct case communication and appointment portal",
    risk: "Validity windows that may expire while no replacement date is assigned",
    escalation:
      "A stated deadline passes, instructions conflict or prolonged delay creates a case-specific legal issue",
  },
  "221(g)": {
    title: "221(g) instruction-monitoring plan",
    watch:
      "Every item requested in the written refusal sheet and any submission or status deadline",
    source:
      "Your 221(g) notice, the issuing post’s instructions and the official case-status channel",
    risk: "Document-submission deadlines and expiring evidence while the case remains pending",
    escalation:
      "The notice is ambiguous, requested evidence raises a legal question or a stated deadline cannot be met",
  },
  "Administrative processing": {
    title: "Administrative-processing monitoring plan",
    watch:
      "Written requests, official case-status changes and document-validity dates — not predicted completion times",
    source:
      "The issuing post’s direct instructions and official case-status channel",
    risk: "Passport access, medical validity and any document the post specifically asks you to renew",
    escalation:
      "You receive a new legal request, instructions conflict or a documented urgent circumstance requires case-specific advice",
  },
  "NVC delay": {
    title: "NVC scheduling monitoring plan",
    watch:
      "Official NVC scheduling messages, issuing-post capacity notices and document readiness",
    source:
      "NVC correspondence, the Department of State and the issuing post’s official notices",
    risk: "Changes in contact details, document readiness and validity while awaiting scheduling",
    escalation:
      "A published or communicated deadline passes or the delay creates a case-specific legal issue",
  },
  "Medical / document expiry concern": {
    title: "Document-validity monitoring plan",
    watch:
      "The exact validity date and the issuing post’s current instructions before renewing or repeating anything",
    source:
      "The issuing post’s official instructions and the authorized document or medical provider",
    risk: "The earliest verified expiration date across medical, passport, police certificate and requested evidence",
    escalation:
      "Renewal timing affects eligibility, travel or compliance with a written case instruction",
  },
  "Something else": {
    title: "Case-change monitoring plan",
    watch:
      "The next written instruction from the agency or issuing post responsible for your current stage",
    source: "The official notice or portal tied directly to your case stage",
    risk: "Any date, validity window or submission requirement stated in writing",
    escalation:
      "The issue requires interpreting law, eligibility or conflicting case-specific instructions",
  },
};

const DEFAULT_PLAN = EVENT_PLANS["Something else"];

const TIMING = {
  "Interview within 7 days": {
    status: "Time-sensitive verification",
    riskPrefix: "Within 7 days, prioritize: ",
  },
  "Interview within 30 days": {
    status: "Upcoming interview watch",
    riskPrefix: "Before the scheduled date, verify: ",
  },
  "Interview already cancelled": {
    status: "Active disruption watch",
    riskPrefix: "While awaiting instructions, track: ",
  },
  "Waiting for new date": {
    status: "Replacement-date watch",
    riskPrefix: "While waiting for a new date, track: ",
  },
  "No interview scheduled yet": {
    status: "Scheduling watch",
    riskPrefix: "Before scheduling, keep current: ",
  },
};

const NEED_CONTEXT = {
  "Knowing when interviews resume":
    "Community reports may indicate movement, but only an official notice or case communication confirms what applies to you.",
  "Seeing whether applicants like me received new dates":
    "Comparable applicant reports are supporting context only; compare embassy, visa category and report date before drawing a pattern.",
  "Protecting medical / document validity":
    "Record exact validity dates and verify renewal instructions before paying for a repeat exam or document.",
  "Understanding what policy changed":
    "Distinguish a published policy change from local operations and from an individual case instruction.",
  "Knowing when I should seek professional help":
    "CaseShield can surface a threshold, but a licensed immigration attorney or DOJ-accredited representative must provide case-specific legal advice.",
};

function cleanLabel(value, fallback) {
  const normalized = String(value || "")
    .replace(/[<>\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return normalized || fallback;
}

export function createCasePlan(answers = {}) {
  const plan = EVENT_PLANS[answers.event] || DEFAULT_PLAN;
  const timing = TIMING[answers.timing] || {
    status: "Monitoring plan",
    riskPrefix: "Verify: ",
  };
  const embassy = cleanLabel(answers.embassy, "your issuing post");
  const visa = cleanLabel(answers.visa, "your visa category");
  const needNote =
    NEED_CONTEXT[answers.need] ||
    "Verify every action against current official instructions for your case.";

  return {
    title: plan.title,
    status: timing.status,
    watch: `${plan.watch} for ${embassy}`,
    source: plan.source,
    risk: `${timing.riskPrefix}${plan.risk}`,
    escalation: plan.escalation,
    note: `${needNote} This plan is scoped to ${visa} and is information, not individualized legal advice.`,
  };
}
