import * as events from 'events';
import { LiskPeer, PeerState, LiskPeerEvent } from "./external/argus/src/peers/Peer";
import { NodeStatus, PeerInfo } from './external/argus/src/peers/LiskClient';

import { LiskHttpApi } from "./liskhttpapi";

export type Chain = Map<number, string>; // height -> broadhash

export interface OwnNode {
  readonly httpPort: number;
  readonly wsPort: number;
  readonly nonce: string;
}

export const enum ApiStatus {
  // value represents a quality value for comparison (higher is better)
  HttpsOpen = 300,
  HttpOpen = 200,
  Closed = 100,
  Unknown = 0,
}

function timePlusMinus(ms: number): number {
  const range = 0.3; // +/- 15 %
  return Math.floor(ms*(1-range) + ms*range*Math.random());
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
  return selection.reduce((sum, element) => sum + element, 0 ) / selection.length;
}

export class MonitoredNode extends events.EventEmitter {
  static readonly EVENT_UPDATED = "updated";

  get chain(): Chain {
    return this._chain;
  }

  get nonce(): string | undefined {
    return this._nonceFromNetwork;
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

  get peers(): PeerInfo[] {
    const peers = this.connectedPeer.peers;
    if (peers) return peers;
    else return [];
  }

  get movingAverageTimeDiffMs(): number {
    return Math.floor(average(this.timeDiffs, 500));
  }

  get movingMinTimeDiffMs(): number {
    return Math.min(...this.timeDiffs.slice(-500));
  }

  public httpApi: LiskHttpApi;
  public httpsApi: LiskHttpApi;

  private readonly connectedPeer: LiskPeer;
  private readonly _chain: Chain = new Map<number, string>(); // height -> broadhash
  private _apiStatus: ApiStatus = ApiStatus.Unknown;
  private _consensus = new Array<number>();
  private _forgingConfigured: string | false | undefined;
  private _isForging: string | false | undefined;
  private _nonceFromNetwork: string | undefined;
  private timeDiffs = new Array<number>();

  constructor(public readonly hostname: string, ownNode: OwnNode) {
    super();

    this.httpApi = new LiskHttpApi(hostname, 7000);
    this.httpsApi = new LiskHttpApi(hostname, 7000, true);

    this.connectedPeer = new LiskPeer({
      ip: hostname,
      httpPort: 7000,
      wsPort: 7001,
      nonce: "",
      nethash: "da3ed6a45429278bac2666961289ca17ad86595d33b31037615d4b8e8f158bba",
      ownHttpPort: ownNode.httpPort,
      ownWSPort: ownNode.wsPort,
    }, ownNode.nonce);

    this.connectedPeer.on(LiskPeerEvent.statusUpdated, (status: NodeStatus) => {
      if (status.height <= 1) {
          // Height is 1 during app start. Ignore those values
          return;
      }

      this._nonceFromNetwork = status.nonce;
      this._chain.set(status.height, shortBroadhash(status));
      this.emit(MonitoredNode.EVENT_UPDATED);
    });

    this.connectedPeer.on(LiskPeerEvent.peersUpdated, (peers: PeerInfo[]) => {
      const mostRecentUpdatedPeerTime = mostRecentPeerUpdate(peers);
      if (mostRecentUpdatedPeerTime) {
        const diff = Date.now() - mostRecentUpdatedPeerTime.getTime();
        this.timeDiffs.push(diff);
        this.emit(MonitoredNode.EVENT_UPDATED);
      }
    });

    setInterval(async () => {
      const newValue = await this.testApiStatus();
      if (this._apiStatus != newValue) {
        this._apiStatus = newValue;
        this.emit(MonitoredNode.EVENT_UPDATED);
      }
    }, timePlusMinus(5000));

    setInterval(async () => {
      let consensus: number | undefined;
      if (this._apiStatus == ApiStatus.HttpOpen) {
        // TODO catch errors from request
        const statusDetailed = await this.connectedPeer.client.getStatusDetailedHTTP();
        consensus = statusDetailed.consensus;
      } else {
        consensus = undefined;
      }

      if (consensus !== undefined) {
        this._consensus.push(consensus);
        this.emit(MonitoredNode.EVENT_UPDATED);
      }
    }, timePlusMinus(3000));

    setInterval(async () => {
      if (this._apiStatus == ApiStatus.HttpOpen) {
        this.httpApi.getStatusForging()
          // handle Lisk bug https://github.com/LiskHQ/lisk/issues/2058
          .then(response => response.data ? response.data : [])
          .then(status => {
            if (status.length > 0) {
              this._forgingConfigured = status[0].publicKey;
              if (status[0].forging) {
                this._isForging = status[0].publicKey;
              } else {
                this._isForging = false;
              }
            } else {
              this._forgingConfigured = false;
              this._isForging = false;
            }
          })
          .catch(error => {
            if (error.statusCode == 403) {
              this._forgingConfigured = undefined;
              this._isForging = undefined;
            } else {
              throw error;
            }
          })
      } else {
        this._forgingConfigured = undefined;
        this._isForging = undefined;
      }
    }, timePlusMinus(3000));
  }

  private async testApiStatus(): Promise<ApiStatus> {
    const host = this.connectedPeer.client.options.hostname;
    const port = this.connectedPeer.client.options.httpPort;

    try {
      await this.httpsApi.getStatus();
      return ApiStatus.HttpsOpen;
    } catch (_) {
      try {
        await this.httpApi.getStatus();
        return ApiStatus.HttpOpen;
      } catch (_) {
        return ApiStatus.Closed;
      }
    }
  }
}
