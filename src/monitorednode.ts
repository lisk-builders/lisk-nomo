import * as events from "events";
import { LiskPeer, PeerState, LiskPeerEvent } from "./external/argus/src/peers/Peer";
import { NodeStatus, PeerInfo } from "./external/argus/src/peers/LiskClient";
import { ResponseList } from "./external/argus/src/lib/HttpApi";

import { ExtendedHttpApi, ForgingStatus } from "./extendedhttpapi";
import { Ping } from "./ping";

export type Chain = Map<number, string>; // height -> broadhash

export const enum ApiStatus {
  // value represents a quality value for comparison (higher is better)
  HttpsOpen = 300,
  HttpOpen = 200,
  Closed = 100,
  Unknown = 0,
}

export interface FullNodeStatus {
  readonly online: boolean;
  readonly version: string | undefined;
  readonly wsPing: number | undefined;
  readonly chain: Chain;
  readonly clockDiffEstimation: number | undefined;
  readonly apiStatus: ApiStatus;
  readonly bestHeight: number | undefined;
  readonly movingAverageConsensus: number | undefined;
  readonly forgingConfigured: string | false | undefined; // string is the pubkey
  readonly isForging: string | false | undefined; // string is the pubkey
  readonly hostname: string;
}

export interface OwnNode {
  readonly httpPort: number;
  readonly wsPort: number;
  readonly nonce: string;
}

function timePlusMinus(ms: number): number {
  const range = 0.3; // +/- 15 %
  return Math.floor(ms * (1 - range) + ms * range * Math.random());
}

const shortBroadhash = (status: NodeStatus) => status.broadhash.substring(0, 6);

function mostRecentPeerUpdate(peers: PeerInfo[]): Date | undefined {
  if (peers.length == 0) {
    return undefined;
  } else {
    const unixTimestampMs = Math.max(...peers.map(p => (p.updated || 0) as number));
    return new Date(unixTimestampMs);
  }
}

function average(array: number[], count: number = Number.POSITIVE_INFINITY) {
  const selection = array.slice(-count);
  return selection.reduce((sum, element) => sum + element, 0) / selection.length;
}

export const enum MonitoredNodeEvents {
  Updated = "updated",
}

export class MonitoredNode extends events.EventEmitter implements FullNodeStatus {
  get chain(): Chain {
    return this._chain;
  }

  get version(): string | undefined {
    return this._version;
  }

  get online(): boolean {
    return this.connectedPeer.state == PeerState.ONLINE;
  }

  get apiStatus(): ApiStatus {
    return this._apiStatus;
  }

  get forgingConfigured(): string | false | undefined {
    return this._forgingConfigured;
  }

  get isForging(): string | false | undefined {
    return this._isForging;
  }

  get movingAverageConsensus(): number | undefined {
    if (this._consensus.length === 0) return undefined;
    return Math.floor(average(this._consensus, 5));
  }

  get movingAverageTimeDiffMs(): number {
    return Math.floor(average(this.timeDiffs, 500));
  }

  // undefined until at least 50 data points are collected
  get movingMinTimeDiffMs(): number | undefined {
    if (this.timeDiffs.length < 50) return undefined;
    else return Math.min(...this.timeDiffs.slice(-500));
  }

  get heightFromApi(): number | undefined {
    return this._heightFromApi;
  }

  get bestHeight(): number | undefined {
    if (this._heightFromApi === undefined && this._heightFromWs === undefined) {
      return undefined;
    }
    return Math.max(this._heightFromApi || 0, this._heightFromWs || 0);
  }

  get wsPing(): number | undefined {
    return this._wsPing;
  }

  get clockDiffEstimation(): number | undefined {
    const timeDiffMs = this.movingMinTimeDiffMs;
    if (timeDiffMs === undefined) return undefined;

    const ping = this.wsPing;
    if (ping === undefined) return undefined;

    return timeDiffMs - ping;
  }

  private readonly httpApi: ExtendedHttpApi;
  private readonly httpsApi: ExtendedHttpApi;
  private readonly connectedPeer: LiskPeer;
  private readonly _chain: Chain = new Map<number, string>(); // height -> broadhash
  private _wsPing: number | undefined;
  private _apiStatus: ApiStatus = ApiStatus.Unknown;
  private _consensus = new Array<number>();
  private _heightFromApi: number | undefined;
  private _heightFromWs: number | undefined;
  private _forgingConfigured: string | false | undefined;
  private _isForging: string | false | undefined;
  private _version: string | undefined;
  private timeDiffs = new Array<number>();

  constructor(
    ownNode: OwnNode,
    public readonly hostname: string,
    public readonly httpPort: number,
    public readonly wsPort: number,
  ) {
    super();

    this.httpApi = new ExtendedHttpApi(hostname, httpPort);
    this.httpsApi = new ExtendedHttpApi(hostname, httpPort, true);

    this.connectedPeer = new LiskPeer(
      {
        ip: hostname,
        httpPort: httpPort,
        wsPort: wsPort,
        nonce: "",
        nethash: "da3ed6a45429278bac2666961289ca17ad86595d33b31037615d4b8e8f158bba",
        ownHttpPort: ownNode.httpPort,
        ownWSPort: ownNode.wsPort,
      },
      ownNode.nonce,
    );

    this.connectedPeer.on(LiskPeerEvent.statusUpdated, (status: NodeStatus) => {
      if (status.height <= 1) {
        // Height is 1 during app start. Ignore those values
        return;
      }

      this._version = status.version;
      this._heightFromWs = status.height;
      this._chain.set(status.height, shortBroadhash(status));
      this.emit(MonitoredNodeEvents.Updated);
    });

    this.connectedPeer.on(LiskPeerEvent.peersUpdated, (peers: PeerInfo[]) => {
      const mostRecentUpdatedPeerTime = mostRecentPeerUpdate(peers);
      if (mostRecentUpdatedPeerTime) {
        const diff = Date.now() - mostRecentUpdatedPeerTime.getTime();
        this.timeDiffs.push(diff);
        this.emit(MonitoredNodeEvents.Updated);
      }
    });

    setInterval(async () => {
      try {
        const ping = await new Ping(this.hostname, this.wsPort).run();
        this._wsPing = Number.isNaN(ping.avg) ? undefined : ping.avg;
      } catch {
        this._wsPing = undefined;
      }
      this.emit(MonitoredNodeEvents.Updated);
    }, timePlusMinus(5000));

    setInterval(async () => {
      const newValue = await this.testApiStatus();
      if (this._apiStatus != newValue) {
        this._apiStatus = newValue;
        this.emit(MonitoredNodeEvents.Updated);
      }
    }, timePlusMinus(5000));

    setInterval(async () => {
      let consensus: number | undefined;
      let height: number | undefined;
      if (this._apiStatus == ApiStatus.HttpOpen) {
        try {
          const statusDetailed = (await this.httpApi.getNodeStatus()).data;
          consensus = statusDetailed.consensus;
          height = statusDetailed.height;
        } catch (_) {
          consensus = undefined;
          height = undefined;
        }
      } else {
        consensus = undefined;
        height = undefined;
      }

      if (this._heightFromApi != height) {
        this._heightFromApi = height;
        this.emit(MonitoredNodeEvents.Updated);
      }

      if (consensus !== undefined) {
        this._consensus.push(consensus);
        this.emit(MonitoredNodeEvents.Updated);
      }
    }, timePlusMinus(3000));

    setInterval(async () => {
      if (this._apiStatus == ApiStatus.HttpOpen) {
        this.httpApi
          .getStatusForging()
          .then(response => response.data)
          .then(forgingStatusList => {
            this.processNewForgingStatus(forgingStatusList);
          })
          .catch(error => {
            if (error.statusCode == 403) {
              this._forgingConfigured = undefined;
              this._isForging = undefined;
            } else {
              throw error;
            }
          });
      } else {
        this._forgingConfigured = undefined;
        this._isForging = undefined;
      }
    }, timePlusMinus(3000));

    setInterval(() => this.cleanup(), timePlusMinus(5 * 60 * 1000));
  }

  public async enableForging(password: string): Promise<ResponseList<ForgingStatus> | undefined> {
    if (typeof this.forgingConfigured === "string") {
      const pubkey = this.forgingConfigured;
      const response = await this.httpApi.updateForging(true, pubkey, password);
      this.processNewForgingStatus(response.data);
      return response;
    } else {
      return undefined;
    }
  }

  public async disableForging(password: string): Promise<ResponseList<ForgingStatus> | undefined> {
    if (typeof this.isForging === "string") {
      const pubkey = this.isForging;
      const response = await this.httpApi.updateForging(false, pubkey, password);
      this.processNewForgingStatus(response.data);
      return response;
    } else {
      return undefined;
    }
  }

  private processNewForgingStatus(forgingStatusList: ForgingStatus[]) {
    if (forgingStatusList.length > 0) {
      const forgingStatus = forgingStatusList[0]; // ignore multi delegate nodes
      this._forgingConfigured = forgingStatus.publicKey;
      if (forgingStatus.forging) {
        this._isForging = forgingStatus.publicKey;
      } else {
        this._isForging = false;
      }
    } else {
      this._forgingConfigured = false;
      this._isForging = false;
    }
  }

  private cleanup(): void {
    const preserveElementsCount = 1000;

    this.timeDiffs = this.timeDiffs.slice(-preserveElementsCount);

    if (this._chain.size > 1.5 * preserveElementsCount) {
      const heightList = Array.from(this._chain.keys());
      heightList.sort();
      while (this._chain.size > preserveElementsCount) {
        const heightToRemove = heightList.shift()!;
        this._chain.delete(heightToRemove);
      }
    }
  }

  private async testApiStatus(): Promise<ApiStatus> {
    try {
      await this.httpsApi.getNodeStatus();
      return ApiStatus.HttpsOpen;
    } catch (_) {
      try {
        await this.httpApi.getNodeStatus();
        return ApiStatus.HttpOpen;
      } catch (_) {
        return ApiStatus.Closed;
      }
    }
  }
}
