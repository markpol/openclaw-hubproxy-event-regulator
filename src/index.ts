#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { Logger } from "./logger.js";
import type { ReplaySimulationResult } from "./replay-simulator.js";
import { simulateReplayFile } from "./replay-simulator.js";
import { EventRegulator } from "./regulator.js";

interface CliOptions {
  configPath?: string;
  omitDropped: boolean;
  outputPath?: string;
  once: boolean;
  replayFilePath?: string;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);

  const config = await loadConfig(resolveConfigPath(options.configPath, process.env));

  if (options.replayFilePath) {
    const simulation = await simulateReplayFile(options.replayFilePath, config);
    const output = `${JSON.stringify(formatReplayOutput(simulation, options.omitDropped), null, 2)}\n`;

    if (options.outputPath) {
      await writeFile(options.outputPath, output, "utf8");
    } else {
      process.stdout.write(output);
    }

    return;
  }

  if (!options.once) {
    throw new Error("Pass --once to run the regulator or --replay-file <path> to process a local events fixture.");
  }

  const logger = new Logger(config.logging.level);
  const regulator = new EventRegulator(config, logger);
  const result = await regulator.runOnce();

  logger.info("Process finished", { ...result });
}

export function parseArgs(argv: string[]): CliOptions {
  let configPath: string | undefined;
  let omitDropped = false;
  let outputPath: string | undefined;
  let once = false;
  let replayFilePath: string | undefined;

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

    if (argument === "--replay-file") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--replay-file requires a path.");
      }

      replayFilePath = next;
      index += 1;
      continue;
    }

    if (argument === "--out") {
      const next = argv[index + 1];
      if (!next) {
        throw new Error("--out requires a path.");
      }

      outputPath = next;
      index += 1;
      continue;
    }

    if (argument === "--omit-dropped") {
      omitDropped = true;
      continue;
    }

    throw new Error(`Unknown argument: ${argument}`);
  }

  if (once && replayFilePath) {
    throw new Error("Use either --once or --replay-file <path>, not both.");
  }

  if (outputPath && !replayFilePath) {
    throw new Error("--out can only be used together with --replay-file.");
  }

  if (omitDropped && !replayFilePath) {
    throw new Error("--omit-dropped can only be used together with --replay-file.");
  }

  const options: CliOptions = { once, omitDropped };
  if (configPath) {
    options.configPath = configPath;
  }
  if (outputPath) {
    options.outputPath = outputPath;
  }
  if (replayFilePath) {
    options.replayFilePath = replayFilePath;
  }

  return options;
}

function printHelp(): void {
  process.stdout.write(`OpenClaw HubProxy Event Regulator

Usage:
  REGULATOR_CONFIG_PATH=/path/to/regulator-config.yaml node dist/index.js --once
  REGULATOR_CONFIG_PATH=/path/to/regulator-config.yaml node dist/index.js --replay-file ./data/test/issues-1.json

Options:
  --once             Run a single replay cycle and exit
  --config <path>    Optional override for REGULATOR_CONFIG_PATH
  --replay-file      Read a local replay/events JSON file, apply filters and transformations, and print the OpenClaw-bound payloads
  --out <path>       Write replay-file output to a file instead of stdout
  --omit-dropped     Exclude the dropped event details array from replay-file output
  --help             Print this help text
`);
}

export function formatReplayOutput(
  simulation: ReplaySimulationResult,
  omitDropped: boolean,
): Omit<ReplaySimulationResult, "dropped"> | ReplaySimulationResult {
  if (!omitDropped) {
    return simulation;
  }

  const { dropped: _dropped, ...output } = simulation;
  return output;
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
