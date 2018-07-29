import { FullNodeStatus } from "./monitorednode";

export interface ObservationResult {
  readonly canForge: Map<string, boolean>;
}

export class Manager {
  private static canForge(node: FullNodeStatus): boolean {
    // Lisk Core minBroadhashConsensus is 51
    return node.online
      && typeof node.forgingConfigured == "string"
      && (node.movingAverageConsensus || 0) >= 51;
  }

  public observe(nodes: ReadonlyArray<FullNodeStatus>): ObservationResult {
    const canForge = new Map<string, boolean>();
    for (const node of nodes) {
      canForge.set(node.hostname, Manager.canForge(node));
    }

    return {
      canForge: canForge,
    }
  }
}
