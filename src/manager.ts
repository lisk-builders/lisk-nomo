import { FullNodeStatus, MonitoredNode } from "./monitorednode";
import * as _ from "underscore";

const jobExecutionDelay = 15; // seconds

export interface ManagerJob {
  readonly disable: string[];
}

export interface ObservationResult {
  readonly canForge: Map<string, boolean>;
  readonly forging: FullNodeStatus[];
  readonly job: ManagerJob | undefined;
  readonly countdown: number | undefined;
}

function compareNodeQuality(a: FullNodeStatus, b: FullNodeStatus): number {
  const aKiloHeight = Math.floor((a.bestHeight || 0) / 1000);
  const bKiloHeight = Math.floor((b.bestHeight || 0) / 1000);

  if (a.online && !b.online) return -1;
  if (!a.online && b.online) return 1;
  if (aKiloHeight > bKiloHeight) return -1;
  if (aKiloHeight < bKiloHeight) return 1;
  if ((a.movingAverageConsensus || 0) > (b.movingAverageConsensus || 0) + 20) return -1;
  if ((a.movingAverageConsensus || 0) < (b.movingAverageConsensus || 0) - 20) return 1;
  return a.hostname.localeCompare(b.hostname);
}

export class Manager {
  private static canForge(node: FullNodeStatus): boolean {
    // Lisk Core minBroadhashConsensus is 51
    return node.online
      && typeof node.forgingConfigured == "string"
      && (node.movingAverageConsensus || 0) >= 51;
  }

  private forgingPassword: string;
  private jobExecTime: Date | undefined;
  private job: ManagerJob | undefined;

  constructor(nodes: ReadonlyArray<MonitoredNode>, forgingPassword: string) {
    setInterval(() => {
      if (this.jobExecTime && this.job && Date.now() >= this.jobExecTime.getTime()) {

        for (const hostname of this.job.disable) {
          const execution = nodes.find(n => n.hostname === hostname)!.disableForging(this.forgingPassword);
          execution
              .then(result => {
                if (!result) {
                  // why did this happen
                } else {
                  // do something with result
                }
              })
              .catch(console.warn);
        }

        this.jobExecTime = undefined;
        this.job = undefined;
      }
    }, 500);

    this.forgingPassword = forgingPassword;
  }

  public observe(nodes: ReadonlyArray<FullNodeStatus>): ObservationResult {
    const canForge = new Map<string, boolean>();
    const forgingNodes = new Array<FullNodeStatus>();
    const disableJob = new Array<string>();
    for (const node of nodes) {
      canForge.set(node.hostname, Manager.canForge(node));
      if (node.isForging) {
        forgingNodes.push(node);
      }
    }

    forgingNodes.sort(compareNodeQuality);

    for (let i = 1; i < forgingNodes.length; ++i) {
      disableJob.push(forgingNodes[i].hostname);
    }

    let job: ManagerJob | undefined;
    let countdown: number | undefined;

    if (disableJob.length > 0) {
      job = {
        disable: disableJob,
      }

      if (this.job && _.isEqual(this.job, job)) {
        // wait for job execution
        countdown = (this.jobExecTime!.getTime() - Date.now()) / 1000;
      } else {
        // new job
        this.job = job;
        this.jobExecTime = new Date(Date.now() + jobExecutionDelay*1000);
      }
    }

    return {
      canForge: canForge,
      forging: forgingNodes,
      job: job,
      countdown: countdown,
    }
  }
}
