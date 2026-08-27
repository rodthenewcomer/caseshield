import test from "node:test";
import assert from "node:assert/strict";
import { createCasePlan } from "../intelligence.js";

test("creates a time-sensitive cancellation plan from the selected answers", () => {
  const plan = createCasePlan({
    event: "Interview cancelled",
    visa: "CR1 / IR1 spouse",
    embassy: "Abidjan",
    timing: "Interview within 7 days",
    need: "Protecting medical / document validity",
  });

  assert.equal(plan.title, "Cancelled interview monitoring plan");
  assert.equal(plan.status, "Time-sensitive verification");
  assert.match(plan.watch, /Abidjan/);
  assert.match(plan.risk, /Within 7 days/);
  assert.match(plan.note, /licensed|validity dates/i);
});

test("does not predict administrative-processing completion", () => {
  const plan = createCasePlan({
    event: "Administrative processing",
    embassy: "London",
    timing: "Waiting for new date",
  });

  assert.match(plan.watch, /not predicted completion times/);
  assert.match(plan.source, /official case-status channel/);
});

test("sanitizes user-provided labels before returning display copy", () => {
  const plan = createCasePlan({
    embassy: "<script>bad</script>\n",
    visa: "Other",
  });
  assert.doesNotMatch(plan.watch, /[<>\r\n]/);
  assert.match(plan.note, /information, not individualized legal advice/);
});
