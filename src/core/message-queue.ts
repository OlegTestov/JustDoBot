import { getLogger } from "./logger";

export class MessageQueue {
  private queue: Array<() => Promise<void>> = [];
  private processing = false;
  private queryLock: Promise<void> = Promise.resolve();
  private _queryLocked = false;

  isProcessing(): boolean {
    return this.processing;
  }

  isQueryLocked(): boolean {
    return this._queryLocked;
  }

  async acquireQueryLock(): Promise<() => void> {
    let release!: () => void;
    const prev = this.queryLock;
    this.queryLock = new Promise((r) => {
      release = r;
    });
    await prev;
    this._queryLocked = true;
    return () => {
      this._queryLocked = false;
      release();
    };
  }

  enqueue(handler: () => Promise<void>): void {
    this.queue.push(handler);
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;
    const task = this.queue.shift()!;
    const release = await this.acquireQueryLock();

    try {
      await task();
    } catch (err) {
      getLogger().error({ err }, "Error processing queued message");
    } finally {
      release();
      this.processing = false;
      this.processNext();
    }
  }

  async drain(): Promise<void> {
    if (!this.processing && this.queue.length === 0) return;

    return new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!this.processing && this.queue.length === 0) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }
}
