import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const checkpointSchema = z.object({
  lastSuccessfulUntil: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class CheckpointStore {
  public constructor(private readonly checkpointFile: string) {}

  public async readSince(defaultSinceHours: number, now: Date): Promise<string> {
    try {
      const contents = (await readFile(this.checkpointFile, "utf8")).trim();
      if (contents.length === 0) {
        return subtractHours(now, defaultSinceHours).toISOString();
      }

      if (contents.startsWith("{")) {
        const parsed = checkpointSchema.parse(JSON.parse(contents));
        return parsed.lastSuccessfulUntil;
      }

      return z.string().datetime().parse(contents);
    } catch (error) {
      if (isMissingFileError(error)) {
        return subtractHours(now, defaultSinceHours).toISOString();
      }

      throw error;
    }
  }

  public async write(until: string, now: Date): Promise<void> {
    await mkdir(path.dirname(this.checkpointFile), { recursive: true });

    const tempPath = `${this.checkpointFile}.tmp`;
    const data = JSON.stringify(
      {
        lastSuccessfulUntil: until,
        updatedAt: now.toISOString(),
      },
      null,
      2,
    );

    await writeFile(tempPath, `${data}\n`, "utf8");
    await rename(tempPath, this.checkpointFile);
  }
}

function subtractHours(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * 60 * 60 * 1_000);
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}
