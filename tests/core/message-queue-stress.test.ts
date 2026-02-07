import { describe, expect, test } from "bun:test";
import { MessageQueue } from "../../src/core/message-queue";

describe("MessageQueue stress", () => {
  test("50 tasks execute in FIFO order", async () => {
    const mq = new MessageQueue();
    const order: number[] = [];

    for (let i = 0; i < 50; i++) {
      const idx = i;
      mq.enqueue(async () => {
        order.push(idx);
      });
    }

    await mq.drain();

    expect(order).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  test("error in one task does not block subsequent tasks", async () => {
    const mq = new MessageQueue();
    const completed: number[] = [];

    for (let i = 0; i < 5; i++) {
      const idx = i;
      mq.enqueue(async () => {
        if (idx === 1) throw new Error("task 1 fails");
        completed.push(idx);
      });
    }

    await mq.drain();

    // Tasks 0, 2, 3, 4 should all complete; task 1 threw but didn't block
    expect(completed).toEqual([0, 2, 3, 4]);
  });

  test("drain() resolves after all tasks complete", async () => {
    const mq = new MessageQueue();
    const results: number[] = [];

    for (let i = 0; i < 10; i++) {
      const idx = i;
      mq.enqueue(async () => {
        // Stagger timings slightly
        await new Promise((r) => setTimeout(r, Math.random() * 5));
        results.push(idx);
      });
    }

    await mq.drain();

    // All 10 tasks completed (order is sequential due to queue)
    expect(results).toHaveLength(10);
    expect(results).toEqual(Array.from({ length: 10 }, (_, i) => i));
  });

  test("acquireQueryLock blocks enqueue processing, release resumes", async () => {
    const mq = new MessageQueue();
    const events: string[] = [];

    // Acquire external lock first
    const release = await mq.acquireQueryLock();
    events.push("lock-acquired");

    // Enqueue a task — it will block because processNext also acquires the lock
    mq.enqueue(async () => {
      events.push("task-executed");
    });

    // Give time for enqueue to attempt processing
    await new Promise((r) => setTimeout(r, 50));
    expect(events).toEqual(["lock-acquired"]);

    // Release the lock — task should now proceed
    release();
    await mq.drain();
    expect(events).toEqual(["lock-acquired", "task-executed"]);
  });
});
