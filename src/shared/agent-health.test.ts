import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeAgentHealth, type AgentRunSlice } from "./agent-health.js";

function run(status: AgentRunSlice["status"], startedAt = Date.now()): AgentRunSlice {
  return { status, startedAt };
}

describe("computeAgentHealth", () => {
  it("returns unknown when no runs", () => {
    assert.equal(computeAgentHealth([]), "unknown");
  });

  it("returns ok when most recent run succeeded", () => {
    assert.equal(computeAgentHealth([run("completed"), run("failed"), run("failed")]), "ok");
  });

  it("returns degraded for 1 consecutive failure", () => {
    assert.equal(computeAgentHealth([run("failed"), run("completed")]), "degraded");
  });

  it("returns degraded for 2 consecutive failures", () => {
    assert.equal(computeAgentHealth([run("failed"), run("failed"), run("completed")]), "degraded");
  });

  it("returns error for 3 consecutive failures", () => {
    assert.equal(computeAgentHealth([run("failed"), run("failed"), run("failed")]), "error");
  });

  it("returns error for 4 consecutive failures", () => {
    assert.equal(
      computeAgentHealth([run("failed"), run("failed"), run("failed"), run("failed"), run("completed")]),
      "error",
    );
  });

  it("treats cancelled as success (not failure)", () => {
    assert.equal(computeAgentHealth([run("cancelled"), run("failed")]), "ok");
  });

  it("returns unknown when healthResetAt filters out all runs", () => {
    const now = Date.now();
    assert.equal(
      computeAgentHealth([run("failed", now - 1000)], now),
      "unknown",
    );
  });

  it("ignores runs before healthResetAt", () => {
    const now = Date.now();
    assert.equal(
      computeAgentHealth(
        [run("completed", now + 100), run("failed", now - 1000), run("failed", now - 2000)],
        now,
      ),
      "ok",
    );
  });

  it("counts only post-reset failures", () => {
    const now = Date.now();
    assert.equal(
      computeAgentHealth(
        [run("failed", now + 200), run("failed", now - 1000)],
        now,
      ),
      "degraded",
    );
  });

  it("ignores running status entries", () => {
    assert.equal(computeAgentHealth([run("running"), run("completed")]), "ok");
  });
});
