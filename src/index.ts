import { MonitoredNode, OwnNode, ApiStatus, Chain, MonitoredNodeEvents } from "./monitorednode";
import { getIp } from "./stun";

function randomCharacter(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return alphabet[Math.floor(Math.random() * alphabet.length)];
}

function randomString(length: number): string {
  return Array.from({ length: length }).map(() => randomCharacter()).join("");
}

const ownNode: OwnNode = {
  httpPort: 3000,
  wsPort: 3001,
  nonce: randomString(16),
};

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
    const max = keys[keys.length - 1];
    const head = chain.get(max);
    chainDescription = `${max}/${head}`;
  }

  return chainDescription;
};

const nodes: ReadonlyArray<MonitoredNode> = [
  new MonitoredNode("node01.testnet.lisk", ownNode),
  new MonitoredNode("node02.testnet.lisk", ownNode),
  new MonitoredNode("wiki.lisk.prolina.org", ownNode),
  new MonitoredNode("testnet.lisk.io", ownNode),
];

function nameWidth(name: string, length: number) {
  let cutName = name.substring(0, length);
  if (cutName != name) {
    cutName = cutName.substring(0, length - 1) + "…";
  }
  return cutName.padEnd(length);
}

function forgingStatus(node: MonitoredNode): string {
  let out: string;
  if (node.isForging) {
    out = `forging (${node.isForging.substring(0, 6)})`;
  } else {
    if (typeof node.forgingConfigured === "undefined") {
      out = "status unknown";
    } else if (node.forgingConfigured === false) {
      out = "not configured";
    } else {
      out = `ready (${node.forgingConfigured.substring(0, 6)})`;
    }
  }
  return out.padEnd(16);
}

function ok(node: MonitoredNode) {
  // Lisk Core minBroadhashConsensus is 51
  return node.online && node.forgingConfigured && (node.movingAverageConsensus || 0) >= 51;
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

function formatSmallTime(ms: number | undefined, undefinedString: string = ""): string {
  if (ms === undefined || Number.isNaN(ms)) {
    return undefinedString.padStart(5);
  }

  const roundedMs = Math.round(ms);
  if (roundedMs > -1000 && roundedMs < 1000) return roundedMs.toString().padStart(3) + "ms";
  else return (roundedMs / 1000).toFixed(1).padStart(4) + "s";
}

function statusLine(node: MonitoredNode): string {
  const online = node.online ? "online " : "offline";
  const api = describeApiStatus(node.apiStatus).padEnd(10);
  const consensus = (typeof node.movingAverageConsensus == "undefined"
    ? "?"
    : node.movingAverageConsensus.toString()
  ).padStart(3);
  const bestHeight = (typeof node.bestHeight == "undefined"
    ? "?"
    : node.bestHeight.toString()
  ).padStart(7);
  return [
    nameWidth(node.hostname, 22),
    formatSmallTime(node.wsPing, "⚠ "),
    online,
    (node.version || "").padStart(10),
    formatSmallTime(node.clockDiffEstimation),
    printHead(node.chain).padEnd(14),
    api,
    consensus,
    bestHeight,
    forgingStatus(node),
    ok(node) ? "ok" : "",
  ].join("  ");
}

function compareNodeQuality(a: MonitoredNode, b: MonitoredNode): number {
  const aKiloHeight = Math.floor((a.bestHeight || 0) / 1000);
  const bKiloHeight = Math.floor((b.bestHeight || 0) / 1000);

  if (a.online && !b.online) return -1;
  if (!a.online && b.online) return 1;
  if (aKiloHeight > bKiloHeight) return -1;
  if (aKiloHeight < bKiloHeight) return 1;
  if (a.apiStatus > b.apiStatus) return -1;
  if (a.apiStatus < b.apiStatus) return 1;
  if (a.forgingConfigured !== undefined && b.forgingConfigured === undefined) return -1;
  if (a.forgingConfigured === undefined && b.forgingConfigured !== undefined) return 1;
  return a.hostname.localeCompare(b.hostname);
}

let ip: string | undefined;
getIp()
  .then(i => (ip = i))
  .catch(console.warn);
setInterval(() => {
  getIp()
    .then(i => (ip = i))
    .catch(console.warn);
}, 60 * 1000);

const logTitles = [
  [
    "".padStart(22),
    "".padStart(22),
    "".padStart(22),
  ],
  [
    "     ",
    "     ",
    "ping ",
  ],
  [
    "       ",
    "       ",
    "socket ",
  ],
  [
    "          ",
    "          ",
    "version   ",
  ],
  [
    "est. ",
    "clock",
    "diff ",
  ],
  [
    "WS     ".padEnd(14),
    "height/".padEnd(14),
    "chain  ".padEnd(14),
  ],
  [
    "   ".padEnd(10),
    "   ".padEnd(10),
    "API".padEnd(10),
  ],
  [
    "con",
    "sen",
    "sus",
  ],
  [
    "WS/API ",
    "best   ",
    "height ",
  ],
  [
    "       ",
    "       ",
    "forging",
  ],
];

function logStatus() {
  const readyToForge = nodes
    .filter(n => typeof n.forgingConfigured === "string")
    .sort(compareNodeQuality);
  const other = nodes.filter(n => typeof n.forgingConfigured !== "string").sort(compareNodeQuality);

  console.log("");
  console.log("========================");
  console.log(`Status time ${new Date(Date.now()).toISOString()} | Monitoring IP: ${ip}`);
  console.log("");

  for (let row = 0; row < 3; ++row) {
    console.log(logTitles.map(cols => cols[row]).join("  "));
  }
  console.log("".padEnd(115, "-"));

  for (const node of readyToForge) {
    console.log(statusLine(node));
  }
  if (readyToForge.length > 0 && other.length > 0) {
    console.log("");
  }
  for (const node of other) {
    console.log(statusLine(node));
  }
}

let lastOutput = 0;
for (const node of nodes) {
  node.on(MonitoredNodeEvents.Updated, () => {
    if (Date.now() - lastOutput > 500) {
      logStatus();
      lastOutput = Date.now();
    }
  });
}
