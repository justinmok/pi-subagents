import type { AgentRecord } from "./types.js";

export type CompletionNudgeSend = (records: AgentRecord[], triggerTurn: boolean) => void;

export class BackgroundCompletionTracker {
  private readonly unconsumed = new Set<string>();

  add(id: string): void {
    this.unconsumed.add(id);
  }

  consume(id: string): void {
    this.unconsumed.delete(id);
  }

  clear(): void {
    this.unconsumed.clear();
  }

  shouldTriggerSingle(id: string): boolean {
    return this.unconsumed.size === 1 && this.unconsumed.has(id);
  }
}

export interface CompletionNudgeCoordinatorOptions {
  delayMs?: number;
  setTimer?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  shouldTriggerSingle?: (record: AgentRecord) => boolean;
  send: CompletionNudgeSend;
}

/**
 * Coordinates background subagent completion nudges so bursts of completions
 * produce a single follow-up, while preserving triggerTurn for a lone unconsumed
 * agent completion.
 */
export class CompletionNudgeCoordinator {
  private readonly delayMs: number;
  private readonly setTimer: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
  private readonly send: CompletionNudgeSend;
  private readonly shouldTriggerSingle: (record: AgentRecord) => boolean;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending = new Map<string, AgentRecord>();

  constructor(options: CompletionNudgeCoordinatorOptions) {
    this.delayMs = options.delayMs ?? 200;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
    this.shouldTriggerSingle = options.shouldTriggerSingle ?? (() => true);
    this.send = options.send;
  }

  schedule(record: AgentRecord): void {
    if (record.resultConsumed) return;
    this.pending.set(record.id, record);
    this.reschedule();
  }

  cancel(id: string): void {
    this.pending.delete(id);
    if (this.pending.size === 0) this.cancelTimer();
  }

  dispose(): void {
    this.pending.clear();
    this.cancelTimer();
  }

  flush(): void {
    this.timer = undefined;
    const records = Array.from(this.pending.values()).filter((record) => !record.resultConsumed);
    this.pending.clear();
    if (records.length === 0) return;

    const triggerTurn = records.length === 1 && this.shouldTriggerSingle(records[0]);
    this.send(records, triggerTurn);
  }

  private reschedule(): void {
    this.cancelTimer();
    this.timer = this.setTimer(() => this.flush(), this.delayMs);
  }

  private cancelTimer(): void {
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = undefined;
    }
  }
}
