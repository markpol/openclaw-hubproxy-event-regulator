import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { countQueueFiles } from "../src/services/queue.js";

test("treats a missing queue directory as empty", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-queue-"));
  const missingQueueDir = path.join(tempDir, "delivery-queue");

  try {
    assert.equal(await countQueueFiles(missingQueueDir), 0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("counts nested queue files when the directory exists", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "openclaw-queue-"));
  const queueDir = path.join(tempDir, "delivery-queue");
  const nestedDir = path.join(queueDir, "nested");

  try {
    await mkdir(nestedDir, { recursive: true });
    await writeFile(path.join(queueDir, "a.txt"), "");
    await writeFile(path.join(nestedDir, "b.txt"), "");

    assert.equal(await countQueueFiles(queueDir), 2);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
