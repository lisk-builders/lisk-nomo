import * as events from "events";
import {
  ForgingStatus,
  HttpApi,
  NodeStatus,
  OwnNodeOptions,
  Peer,
  PeerEvent,
  PeerState,
  PeerInfo,
  ResponseList,
} from "libargus";
import * as log from "winston";

import { Ping } from "./ping";

export type Chain = Map<number, string>; // height -> broadhash

export const enum ApiStatus {
  // raw value are for the API
  HttpsOpen = "https",
  HttpOpen = "http",
  Closed = "closed",
}

export interface ChainHead {
  readonly height: number;
  readonly broadhash: string;
}

export interface FullNodeStatus {
  readonly online: boolean;
  readonly version: string | undefined;
  readonly wsPing: number | undefined;
  readonly chainHead: ChainHead | undefined;
  readonly clockDiffEstimation: number | undefined;
  readonly apiStatus: ApiStatus | undefined;
  readonly apiHeight: number | undefined;
  readonly wsHeight: number | undefined;
  readonly bestHeight: number | undefined;
  readonly movingAverageConsensus: number | undefined;
  readonly forgingConfigured: string | false | undefined; // string is the pubkey
  readonly isForging: string | false | undefined; // string is the pubkey
  readonly hostname: string;
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

export class MonitoredNode extends events.EventEmitter {
  get status(): FullNodeStatus {
    return {
      online: this.connectedPeer.state === PeerState.Online,
      version: this._version,
      wsPing: this._wsPing,
      chainHead: this.chainHead,
      clockDiffEstimation: this.clockDiffEstimation,
      apiStatus: this._apiStatus,
      wsHeight: this.wsHeight,
      apiHeight: this._apiHeight,
      bestHeight: this.bestHeight,
      movingAverageConsensus: this.movingAverageConsensus,
      forgingConfigured: this._forgingConfigured, // string is the pubkey
      isForging: this._isForging, // string is the pubkey
      hostname: this.hostname,
    };
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

  get wsHeight(): number | undefined {
    const keys = Array.from(this._chain.keys());
    if (keys.length === 0) {
      return undefined;
    } else {
      return Math.max(...keys);
    }
  }

  get chainHead(): ChainHead | undefined {
    if (this._chain.size == 0) {
      return undefined;
    } else {
      const maxKey = Math.max(...this._chain.keys());
      return {
        height: maxKey,
        broadhash: this._chain.get(maxKey)!,
      };
    }
  }

  get bestHeight(): number | undefined {
    if (this._apiHeight === undefined && this._heightFromWs === undefined) {
      return undefined;
    }
    return Math.max(this._apiHeight || 0, this._heightFromWs || 0);
  }

  get clockDiffEstimation(): number | undefined {
    const timeDiffMs = this.movingMinTimeDiffMs;
    if (timeDiffMs === undefined) return undefined;

    const ping = this._wsPing;
    if (ping === undefined) return undefined;

    return timeDiffMs - ping;
  }

  get bestApi(): HttpApi {
    if (this._apiStatus == ApiStatus.HttpsOpen) {
      return this.httpsApi;
    } else {
      return this.httpApi;
    }
  }

  private readonly httpsApi: HttpApi;
  private readonly httpApi: HttpApi;
  private readonly connectedPeer: Peer;
  private readonly _chain: Chain = new Map<number, string>(); // height -> broadhash
  private _wsPing: number | undefined;
  private _apiStatus: ApiStatus | undefined;
  private _consensus = new Array<number>();
  private _apiHeight: number | undefined;
  private _heightFromWs: number | undefined;
  private _forgingConfigured: string | false | undefined;
  private _isForging: string | false | undefined;
  private _version: string | undefined;
  private timeDiffs = new Array<number>();

  constructor(
    ownNode: OwnNodeOptions,
    public readonly hostname: string,
    public readonly httpsPort: number,
    public readonly httpPort: number,
    public readonly wsPort: number,
    public readonly nethash: string,
  ) {
    super();

    this.httpsApi = new HttpApi(hostname, httpsPort, true);
    this.httpApi = new HttpApi(hostname, httpPort);

    this.connectedPeer = new Peer(
      {
        ip: hostname,
        httpPort: httpPort,
        wsPort: wsPort,
        nethash: nethash,
      },
      ownNode,
    );

    this.connectedPeer.on(PeerEvent.StatusUpdated, (status: NodeStatus) => {
      if (status.height <= 1) {
        // Height is 1 during app start. Ignore those values
        return;
      }

      this._version = status.version;
      this._heightFromWs = status.height;
      this._chain.set(status.height, shortBroadhash(status));
      this.emit(MonitoredNodeEvents.Updated);
    });

    this.connectedPeer.on(PeerEvent.PeersUpdated, (peers: PeerInfo[]) => {
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
        this._wsPing = Number.isNaN(ping.avg) ? undefined : Math.round(ping.avg);
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

      try {
        const statusDetailed = (await this.bestApi.getNodeStatus()).data;
        consensus = statusDetailed.consensus;
        height = statusDetailed.height;
      } catch (_) {
        consensus = undefined;
        height = undefined;
      }

      if (this._apiHeight != height) {
        this._apiHeight = height;
        this.emit(MonitoredNodeEvents.Updated);
      }

      if (consensus !== undefined) {
        this._consensus.push(consensus);
        this.emit(MonitoredNodeEvents.Updated);
      }
    }, timePlusMinus(3000));

    setInterval(async () => {
      if (this._apiStatus == ApiStatus.HttpOpen || this._apiStatus == ApiStatus.HttpsOpen) {
        this.bestApi
          .getForgingStatus()
          .then(response => response.data)
          .then(forgingStatusList => {
            this.processNewForgingStatus(forgingStatusList);
          })
          .catch(error => {
            if (error.statusCode == 403) {
              this._forgingConfigured = undefined;
              this._isForging = undefined;
            } else {
              log.error(error);
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
    if (typeof this._forgingConfigured === "string") {
      const pubkey = this._forgingConfigured;
      const response = await this.bestApi.updateForging(true, pubkey, password);
      this.processNewForgingStatus(response.data);
      return response;
    } else {
      return undefined;
    }
  }

  public async disableForging(password: string): Promise<ResponseList<ForgingStatus> | undefined> {
    if (typeof this._isForging === "string") {
      const pubkey = this._isForging;
      const response = await this.bestApi.updateForging(false, pubkey, password);
      this.processNewForgingStatus(response.data);
      return response;
    } else {
      return undefined;
    }
  }

  private processNewForgingStatus(forgingStatusList: ReadonlyArray<ForgingStatus>) {
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
