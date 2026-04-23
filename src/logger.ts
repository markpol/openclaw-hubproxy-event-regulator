import type { LogLevel } from "./config.js";

const levelWeights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  public constructor(private readonly level: LogLevel) {}

  public debug(message: string, fields: Record<string, unknown> = {}): void {
    this.log("debug", message, fields);
  }

  public info(message: string, fields: Record<string, unknown> = {}): void {
    this.log("info", message, fields);
  }

  public warn(message: string, fields: Record<string, unknown> = {}): void {
    this.log("warn", message, fields);
  }

  public error(message: string, fields: Record<string, unknown> = {}): void {
    this.log("error", message, fields);
  }

  private log(level: LogLevel, message: string, fields: Record<string, unknown>): void {
    if (levelWeights[level] < levelWeights[this.level]) {
      return;
    }

    process.stdout.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...fields,
      })}\n`,
    );
  }
}
