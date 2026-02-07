import { describe, expect, test } from "bun:test";
import { MessageQueue } from "../../src/core/message-queue";

describe("MessageQueue lock", () => {
  test("acquireQueryLock blocks subsequent acquires", async () => {
    const mq = new MessageQueue();
    const order: number[] = [];

    const release1 = await mq.acquireQueryLock();
    expect(mq.isQueryLocked()).toBe(true);
    order.push(1);

    // Second acquire should block until release1 is called
    const p2 = mq.acquireQueryLock().then((release2) => {
      order.push(2);
      release2();
    });

    // Give p2 a chance to resolve (it shouldn't yet)
    await new Promise((r) => setTimeout(r, 50));
    expect(order).toEqual([1]);

    release1();
    await p2;
    expect(order).toEqual([1, 2]);
    expect(mq.isQueryLocked()).toBe(false);
  });

  test("isProcessing reflects enqueue state", async () => {
    const mq = new MessageQueue();
    expect(mq.isProcessing()).toBe(false);

    let resolver!: () => void;
    const taskPromise = new Promise<void>((r) => {
      resolver = r;
    });

    mq.enqueue(async () => {
      await taskPromise;
    });

    // Wait for processing to start
    await new Promise((r) => setTimeout(r, 10));
    expect(mq.isProcessing()).toBe(true);

    resolver();
    await mq.drain();
    expect(mq.isProcessing()).toBe(false);
  });

  test("enqueued tasks run sequentially", async () => {
    const mq = new MessageQueue();
    const order: number[] = [];

    mq.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 30));
      order.push(1);
    });
    mq.enqueue(async () => {
      order.push(2);
    });
    mq.enqueue(async () => {
      order.push(3);
    });

    await mq.drain();
    expect(order).toEqual([1, 2, 3]);
  });
});
