import { readdir } from "node:fs/promises";
import path from "node:path";

export async function countQueueFiles(queueDir: string): Promise<number> {
  const entries = await readDirectoryEntries(queueDir);
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

async function readDirectoryEntries(queueDir: string) {
  try {
    return await readdir(queueDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }

    throw error;
  }
}

function isMissingDirectoryError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
