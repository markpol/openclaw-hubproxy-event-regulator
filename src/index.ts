#!/usr/bin/env node

import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import { EventRegulator } from "./regulator.js";

interface CliOptions {
  configPath?: string;
  once: boolean;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);

  if (!options.once) {
    throw new Error("Version 1 only supports --once mode.");
  }

  const config = await loadConfig(resolveConfigPath(options.configPath, process.env));
  const logger = new Logger(config.logging.level);
  const regulator = new EventRegulator(config, logger);
  const result = await regulator.runOnce();

  logger.info("Process finished", { ...result });
}

function parseArgs(argv: string[]): CliOptions {
  let configPath: string | undefined;
  let once = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--help") {
      printHelp();
      process.exit(0);
    }

    if (argument === "--once") {
      once = true;
      continue;
    }

    if (argument === "--config") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--config requires a path.");
      }

      configPath = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  return configPath
    ? {
        configPath,
        once,
      }
    : {
        once,
      };
}

function printHelp(): void {
  process.stdout.write(`OpenClaw HubProxy Event Regulator

Usage:
  REGULATOR_CONFIG_PATH=/path/to/regulator-config.yaml node dist/index.js --once

Options:
  --once             Run a single replay cycle and exit
  --config <path>    Optional override for REGULATOR_CONFIG_PATH
  --help             Print this help text
`);
}

export function resolveConfigPath(
  configPath: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  return configPath ?? env.REGULATOR_CONFIG_PATH ?? missingConfigPath();
}

function missingConfigPath(): never {
  throw new Error(
    "Configuration path is required. Set REGULATOR_CONFIG_PATH or pass --config <path>.",
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), level: "error", message })}\n`,
    );
    process.exitCode = 1;
  });
}
