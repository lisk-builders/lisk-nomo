import { ObservationResult } from "./manager";
import { FullNodeStatus } from "./monitorednode";

export interface MonitoringState {
  readonly time: string; // RFC3339
  readonly ip: string | undefined;
  readonly nodes: ReadonlyArray<FullNodeStatus>;
  readonly observation: ObservationResult | undefined;
}
