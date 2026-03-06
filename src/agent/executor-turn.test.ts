import assert from "node:assert/strict";
import test from "node:test";
import { shouldResetCodexSessionForSandbox } from "./executor-turn.js";

test("shouldResetCodexSessionForSandbox only resets codex sandbox resume", () => {
  assert.equal(
    shouldResetCodexSessionForSandbox({
      provider: "codex",
      executionMode: "workspace-sandbox",
      hasSessionId: true,
    }),
    true
  );

  assert.equal(
    shouldResetCodexSessionForSandbox({
      provider: "codex",
      executionMode: "full-access",
      hasSessionId: true,
    }),
    false
  );

  assert.equal(
    shouldResetCodexSessionForSandbox({
      provider: "claude",
      executionMode: "workspace-sandbox",
      hasSessionId: true,
    }),
    false
  );

  assert.equal(
    shouldResetCodexSessionForSandbox({
      provider: "codex",
      executionMode: "workspace-sandbox",
      hasSessionId: false,
    }),
    false
  );
});
