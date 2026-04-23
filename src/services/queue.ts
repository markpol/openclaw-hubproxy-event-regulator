import { readdir } from "node:fs/promises";
import path from "node:path";

export async function countQueueFiles(queueDir: string): Promise<number> {
  const entries = await readdir(queueDir, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const fullPath = path.join(queueDir, entry.name);

    if (entry.isFile()) {
      count += 1;
    } else if (entry.isDirectory()) {
      count += await countQueueFiles(fullPath);
    }
  }

  return count;
}
