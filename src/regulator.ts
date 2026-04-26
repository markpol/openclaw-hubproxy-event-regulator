import type { RegulatorConfig } from "./config.js";
import { Logger } from "./logger.js";
import { evaluateEventFilter } from "./rules/filter.js";
import { transformPayload } from "./rules/transform.js";
import { CheckpointStore } from "./services/checkpoint-store.js";
import { countQueueFiles } from "./services/queue.js";
import type { CycleResult } from "./types.js";
import { HubProxyClient } from "./clients/hubproxy-client.js";
import { OpenClawClient } from "./clients/openclaw-client.js";

export class EventRegulator {
  private readonly checkpointStore: CheckpointStore;
  private readonly hubProxyClient: HubProxyClient;
  private readonly openClawClient: OpenClawClient;

  public constructor(
    private readonly config: RegulatorConfig,
    private readonly logger: Logger,
  ) {
    this.checkpointStore = new CheckpointStore(config.checkpointFile);
    this.hubProxyClient = new HubProxyClient(config, logger);
    this.openClawClient = new OpenClawClient(config, logger);
  }

  public async runOnce(now = new Date()): Promise<CycleResult> {
    const queueDepth = await countQueueFiles(this.config.queueDir);

    if (queueDepth > this.config.maxQueueThreshold) {
      this.logger.info("OpenClaw queue is busy, skipping replay cycle", {
        queueDepth,
        maxQueueThreshold: this.config.maxQueueThreshold,
      });

      return {
        status: "skipped",
        queueDepth,
        replayedCount: 0,
        forwardedCount: 0,
        droppedCount: 0,
        reason: "queue_busy",
      };
    }

    const since = await this.checkpointStore.readSince(this.config.defaultSinceHours, now);
    const until = now.toISOString();
    const replayTypes = getReplayEventTypes(this.config);

    this.logger.info("Starting replay cycle", {
      since,
      until,
      replayTypes,
      replayBatchSize: this.config.replayBatchSize,
      queueDepth,
    });

    const replayResult = await this.hubProxyClient.replay({
      since,
      until,
      limit: this.config.replayBatchSize,
      types: replayTypes,
    });

    let forwardedCount = 0;
    let droppedCount = 0;

    for (const event of replayResult.events) {
      const filterResult = evaluateEventFilter(event, this.config.filters[event.event]);
      if (!filterResult.allowed) {
        droppedCount += 1;
        this.logger.info("Dropping event after filter evaluation", {
          event: event.event,
          deliveryId: event.deliveryId,
          reason: filterResult.reason,
        });
        continue;
      }

      const transformation = this.config.transformations[event.event];
      if (!transformation) {
        droppedCount += 1;
        this.logger.warn("Dropping event without matching transformation", {
          event: event.event,
          deliveryId: event.deliveryId,
        });
        continue;
      }

      const transformedPayload = transformPayload(event.payload, transformation);
      await this.openClawClient.forward(event, transformedPayload, transformation);
      forwardedCount += 1;
    }

    await this.checkpointStore.write(until, now);

    this.logger.info("Replay cycle completed", {
      since,
      until,
      queueDepth,
      replayedCount: replayResult.replayedCount,
      forwardedCount,
      droppedCount,
    });

    return {
      status: "completed",
      since,
      until,
      queueDepth,
      replayedCount: replayResult.replayedCount,
      forwardedCount,
      droppedCount,
    };
  }
}

function getReplayEventTypes(config: RegulatorConfig): string[] {
  if (config.replayEventTypes.length > 0) {
    return config.replayEventTypes;
  }

  return Array.from(
    new Set([
      ...Object.keys(config.filters),
      ...Object.keys(config.transformations),
    ]),
  );
}
