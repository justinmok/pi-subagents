import { describe, expect, it, vi } from "vitest";
import { BackgroundCompletionTracker, CompletionNudgeCoordinator } from "../src/completion-nudges.js";
import type { AgentRecord } from "../src/types.js";

function record(id: string, resultConsumed = false): AgentRecord {
  return {
    id,
    type: "general-purpose",
    description: id,
    status: "completed",
    toolUses: 0,
    startedAt: 0,
    completedAt: 1,
    result: "done",
    resultConsumed,
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
    compactionCount: 0,
  };
}

describe("BackgroundCompletionTracker", () => {
  it("suppresses trigger-turn while multiple unconsumed background agents are outstanding", () => {
    const tracker = new BackgroundCompletionTracker();
    tracker.add("agent-1");
    tracker.add("agent-2");

    expect(tracker.shouldTriggerSingle("agent-1")).toBe(false);
    expect(tracker.shouldTriggerSingle("agent-2")).toBe(false);
  });

  it("allows trigger-turn for a lone unconsumed background agent", () => {
    const tracker = new BackgroundCompletionTracker();
    tracker.add("agent-1");
    tracker.add("agent-2");
    tracker.consume("agent-1");

    expect(tracker.shouldTriggerSingle("agent-2")).toBe(true);
  });
});

describe("CompletionNudgeCoordinator", () => {
  it("sends one trigger-turn nudge for a single unconsumed completion", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const coordinator = new CompletionNudgeCoordinator({ delayMs: 200, send });

      coordinator.schedule(record("agent-1"));
      vi.advanceTimersByTime(199);
      expect(send).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith([expect.objectContaining({ id: "agent-1" })], true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces multiple completions into one non-triggering nudge", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const coordinator = new CompletionNudgeCoordinator({ delayMs: 200, send });

      coordinator.schedule(record("agent-1"));
      vi.advanceTimersByTime(100);
      coordinator.schedule(record("agent-2"));
      vi.advanceTimersByTime(199);
      expect(send).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(send).toHaveBeenCalledOnce();
      expect(send.mock.calls[0][0].map((r: AgentRecord) => r.id)).toEqual(["agent-1", "agent-2"]);
      expect(send.mock.calls[0][1]).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("can suppress trigger-turn for separated completions that belong to a known multi-agent run", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const coordinator = new CompletionNudgeCoordinator({
        delayMs: 200,
        send,
        shouldTriggerSingle: () => false,
      });

      coordinator.schedule(record("agent-1"));
      vi.advanceTimersByTime(200);
      coordinator.schedule(record("agent-2"));
      vi.advanceTimersByTime(200);

      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[0][0].map((r: AgentRecord) => r.id)).toEqual(["agent-1"]);
      expect(send.mock.calls[0][1]).toBe(false);
      expect(send.mock.calls[1][0].map((r: AgentRecord) => r.id)).toEqual(["agent-2"]);
      expect(send.mock.calls[1][1]).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels queued completion nudges when result is requested before delivery", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const coordinator = new CompletionNudgeCoordinator({ delayMs: 200, send });

      coordinator.schedule(record("agent-1"));
      coordinator.cancel("agent-1");
      vi.advanceTimersByTime(200);

      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters records marked consumed after scheduling but before delivery", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const coordinator = new CompletionNudgeCoordinator({ delayMs: 200, send });
      const agent = record("agent-1");

      coordinator.schedule(agent);
      agent.resultConsumed = true;
      vi.advanceTimersByTime(200);

      expect(send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
