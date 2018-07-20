import * as events from 'events';
import * as request from 'request-promise-native'
import { LiskPeer, PeerState, LiskPeerEvent } from "./external/argus/src/peers/Peer";
import { NodeStatus, PeerInfo } from "./external/argus/src/peers/LiskClient";

import { getIp } from "./stun";

const ownHttpPort = 3000;
const ownWsPort = 3001;
const ownNonce = "aiConi9OSo5shoot"
const EVENT_UPDATED = "updated";

type Chain = Map<number, string>; // height -> broadhash

const enum ApiStatus {
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

class MonitoredNode extends events.EventEmitter {
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

    get forgingConfigured(): string | false {
        return this._forgingConfigured;
    }

    get isForging(): string | false {
        return this._isForging;
    }

    get movingAverageConsensus(): number | undefined {
        if (this._consensus.length === 0) return undefined;
        return Math.floor(average(this._consensus, 3));
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

    private readonly connectedPeer: LiskPeer;
    private readonly _chain: Chain = new Map<number, string>(); // height -> broadhash
    private _apiStatus: ApiStatus = ApiStatus.Unknown;
    private _consensus = new Array<number>();
    private _forgingConfigured: string | false | undefined;
    private _isForging: string | false | undefined;
    private _nonceFromNetwork: string | undefined;
    private timeDiffs = new Array<number>();

    constructor(public readonly hostname: string) {
        super();

        this.connectedPeer = new LiskPeer({
            ip: hostname,
            httpPort: 7000,
            wsPort: 7001,
            nonce: "",
            nethash: "da3ed6a45429278bac2666961289ca17ad86595d33b31037615d4b8e8f158bba",
            ownHttpPort: ownHttpPort,
            ownWSPort: ownWsPort,
        }, ownNonce);
    
        this.connectedPeer.on(LiskPeerEvent.statusUpdated, (status: NodeStatus) => {
            if (status.height <= 1) {
                // Height is 1 during app start. Ignore those values
                return;
            }

            this._nonceFromNetwork = status.nonce;
            this._chain.set(status.height, shortBroadhash(status));
            this.emit(EVENT_UPDATED);
        });

        this.connectedPeer.on(LiskPeerEvent.peersUpdated, (peers: PeerInfo[]) => {
            const time = mostRecentPeerUpdate(peers);
            const diff = Date.now() - time.getTime();
            this.timeDiffs.push(diff);
            this.emit(EVENT_UPDATED);
        });

        setInterval(async () => {
            const newValue = await this.testApiStatus();
            if (this._apiStatus != newValue) {
                this._apiStatus = newValue;
                this.emit(EVENT_UPDATED);
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
                this.emit(EVENT_UPDATED);
            }
        }, timePlusMinus(3000));

        setInterval(async () => {
            if (this._apiStatus == ApiStatus.HttpOpen) {
                this.connectedPeer.client.getStatusForgingHTTP()
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
            await request(`https://${host}:${port}/api/node/status`, {json: true});
            return ApiStatus.HttpsOpen;
        } catch (_) {
            try {
                await request(`http://${host}:${port}/api/node/status`, {json: true});
                return ApiStatus.HttpOpen;
            } catch (_) {
                return ApiStatus.Closed;
            }
        }
    }
}

const debugChain = (chain: Chain): string => {
    const keys = Array.from(chain.keys());
    keys.sort();

    let chainDescription: string;
    if (keys.length == 0) {
        chainDescription = "empty";
    } else {
        const min = keys[0];
        const max = keys[keys.length-1];
        const length = max-min+1;
        let missing = 0;
        for (let i = min; i <= max; ++i) {
            if (!keys.includes(i)) {
                missing += 1;
            }
        }
        const head = chain.get(max);        
        chainDescription = `from: ${min}, to: ${max}, length: ${length}, missing: ${missing}, head: ${head}`;
    }

    return `Chain{${chainDescription}}`;
}

const printHead = (chain: Chain): string => {
    const keys = Array.from(chain.keys());
    keys.sort();

    let chainDescription: string;
    if (keys.length == 0) {
        chainDescription = "unknown";
    } else {
        const max = keys[keys.length-1];
        const head = chain.get(max);        
        chainDescription = `${max}/${head}`;
    }

    return `Head{${chainDescription}}`;
}

const nodes: ReadonlyArray<MonitoredNode> = [
    new MonitoredNode("node01.testnet.lisk"),
    new MonitoredNode("node02.testnet.lisk"),
    new MonitoredNode("wiki.lisk.prolina.org"),
    new MonitoredNode("testnet.lisk.io"),
]

function nameWidth(name: string, length: number) {
    let cutName = name.substring(0, length);
    if (cutName != name) {
        cutName = cutName.substring(0, length-1) + "…"; 
    }
    return cutName.padEnd(length);
}

function forgingStatus(node: MonitoredNode): string {
    let out: string;
    if (node.isForging) {
        out = `forging (${node.isForging.substring(0, 6)})`;
    } else {
        if (typeof(node.forgingConfigured) === "undefined") {
            out = "forging status unknown";
        } else if (node.forgingConfigured === false) {
            out = "forging not configured";
        } else {
            out = `ready to forge (${node.forgingConfigured.substring(0, 6)})`;
        }
    }
    return out.padEnd(23);
}

function ok(node: MonitoredNode) {
    return node.online
        && node.forgingConfigured
        && (node.movingAverageConsensus || 0) >= 51 // Lisk Core minBroadhashConsensus
}

function describeApiStatus(status: ApiStatus) {
    switch (status) {
        case ApiStatus.Unknown:
            return "unknown";
        case ApiStatus.Closed:
            return "API closed";
        case ApiStatus.HttpsOpen:
            return "HTTPs open";
        case ApiStatus.HttpOpen:
            return "HTTP open";
    }
}

function statusLine(node: MonitoredNode): string {
    const online = node.online
        ? "online "
        : "offline";
    const api = describeApiStatus(node.apiStatus).padEnd(10);
    const consensus = (typeof node.movingAverageConsensus == "undefined" ? "?" : node.movingAverageConsensus.toString()).padStart(3);
    return [
        nameWidth(node.hostname, 22),
        online,
        node.movingMinTimeDiffMs.toString().padStart(3) + "ms",
        printHead(node.chain),
        api,
        consensus,
        forgingStatus(node),
        ok(node) ? "ok" : ""
    ].join("  ");
}

function compareNodeQuality(a: MonitoredNode, b: MonitoredNode): number {
    if (a.online && !b.online) return -1;
    if (!a.online && b.online) return 1;
    if (a.apiStatus > b.apiStatus) return -1;
    if (a.apiStatus < b.apiStatus) return 1;
    if (a.forgingConfigured !== undefined && b.forgingConfigured === undefined) return -1;
    if (a.forgingConfigured === undefined && b.forgingConfigured !== undefined) return 1;
    return a.hostname.localeCompare(b.hostname);
}

let ip: string | undefined;
getIp().then(i => ip = i).catch(() => { /* ignore */ } );
setInterval(() => {
    getIp().then(i => ip = i).catch(() => { /* ignore */ } );
}, 60*1000);

function logStatus() {
    const readyToForge = nodes.filter(n => typeof(n.forgingConfigured) === "string").sort(compareNodeQuality);
    const other = nodes.filter(n => typeof(n.forgingConfigured) !== "string").sort(compareNodeQuality);

    console.log("");
    console.log("========================");
    console.log(`Status time ${new Date(Date.now()).toISOString()} | Monitoring IP: ${ip}`);
    console.log("");
    console.log("Nodes ready to forge");
    for (const node of readyToForge) {    
        console.log("  " + statusLine(node));
    }
    if (readyToForge.length === 0) {
        console.log("  none")
    }

    console.log("Other nodes");
    for (const node of other) {
        console.log("  " + statusLine(node));
    }
    if (other.length === 0) {
        console.log("  none")
    }
}

for (const node of nodes) {
    node.on(EVENT_UPDATED, () => logStatus());
}