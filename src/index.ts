
import { MonitoredNode, OwnNode, ApiStatus, Chain, MonitoredNodeEvents } from "./monitorednode";
import { getIp } from "./stun";

const ownNode: OwnNode = {
  httpPort: 3000,
  wsPort: 3001,
  nonce: "aiConi9OSo5shoot",
}

/*
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
*/

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
  new MonitoredNode("node01.testnet.lisk", ownNode),
  new MonitoredNode("node02.testnet.lisk", ownNode),
  new MonitoredNode("wiki.lisk.prolina.org", ownNode),
  new MonitoredNode("testnet.lisk.io", ownNode),
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

function formatTimeDiff(ms: number | undefined): string {
  if (ms === undefined) return "".padStart(5)
  else if (ms > -1000 && ms < 1000) return ms.toString().padStart(3) + "ms";
  else return (ms/1000).toFixed(1).padStart(4) + "s";
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
    (node.version || "").padStart(10),
    formatTimeDiff(node.movingMinTimeDiffMs),
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
getIp().then(i => ip = i).catch(console.warn);
setInterval(() => {
  getIp().then(i => ip = i).catch(console.warn);
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

let lastOutput = 0;
for (const node of nodes) {
  node.on(MonitoredNodeEvents.Updated, () => {
    if (Date.now() - lastOutput > 500) {
      logStatus()
      lastOutput = Date.now();
    }
  });
}
