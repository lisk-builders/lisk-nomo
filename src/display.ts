import { ObservationResult } from "./manager";
import { ApiStatus, Chain, FullNodeStatus } from "./monitorednode";
import { MonitoringState } from "./monitoringstate";

function compareNodeQuality(a: FullNodeStatus, b: FullNodeStatus): number {
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

const logTitles = [
  ["".padStart(22), "".padStart(22), "".padStart(22)],
  ["     ", "     ", "ping "],
  ["       ", "       ", "socket "],
  ["          ", "          ", "version   "],
  ["est. ", "clock", "diff "],
  ["WS     ".padEnd(14), "height/".padEnd(14), "chain  ".padEnd(14)],
  ["   ".padEnd(6), "   ".padEnd(6), "API".padEnd(6)],
  ["WS/API ", "best   ", "height "],
  ["con", "sen", "sus"],
  ["       ", "       ", "forging"],
];

function printChainHead(chain: Chain): string {
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
}

function formatSmallTime(ms: number | undefined, undefinedString: string = ""): string {
  if (ms === undefined || Number.isNaN(ms)) {
    return undefinedString.padStart(5);
  }

  const roundedMs = Math.round(ms);
  if (roundedMs > -1000 && roundedMs < 1000) return roundedMs.toString().padStart(3) + "ms";
  else return (roundedMs / 1000).toFixed(1).padStart(4) + "s";
}

function nameWidth(name: string, length: number) {
  let cutName = name.substring(0, length);
  if (cutName != name) {
    cutName = cutName.substring(0, length - 1) + "…";
  }
  return cutName.padEnd(length);
}

function forgingStatus(node: FullNodeStatus): string {
  let out: string;
  if (node.isForging) {
    out = "forging";
  } else {
    if (typeof node.forgingConfigured === "undefined") {
      out = "unknown";
    } else if (node.forgingConfigured === false) {
      out = "not configured";
    } else {
      out = "configured";
    }
  }
  return out.padEnd(14);
}

function describeApiStatus(status: ApiStatus) {
  switch (status) {
    case ApiStatus.Unknown:
      return "?";
    case ApiStatus.Closed:
      return "closed";
    case ApiStatus.HttpsOpen:
      return "HTTPs";
    case ApiStatus.HttpOpen:
      return "HTTP";
  }
}

function statusLine(
  node: FullNodeStatus,
  managerCanForge: boolean,
  managerCountdown: number | undefined,
): string {
  const online = node.online ? "online " : "offline";
  const api = describeApiStatus(node.apiStatus).padEnd(6);
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
    printChainHead(node.chain).padEnd(14),
    api,
    bestHeight,
    consensus,
    forgingStatus(node),
    managerCountdown ? Math.round(managerCountdown) : managerCanForge ? "ready" : "",
  ].join("  ");
}

function prepareLine(line: string, targetLength: number) {
  return line.substring(0, targetLength).padEnd(targetLength);
}

function writeScreen(lines: string[]) {
  const columns =
    process.stdout.columns !== undefined
      ? process.stdout.columns
      : Math.max(...lines.map(line => line.length));

  let out = new Array(...lines.map(line => prepareLine(line, columns)));

  if (process.stdout.rows != undefined) {
    for (let i = 0; i < process.stdout.rows - lines.length - 1; ++i) {
      out.push(prepareLine("", columns));
    }
  }
  console.log("\u001b[1;1H" + out.join("\n"));
}

export function displayState(state: MonitoringState) {
  const out = new Array<string>();

  const readyToForge = state.nodes
    .filter(n => typeof n.forgingConfigured === "string")
    .sort(compareNodeQuality);
  const other = state.nodes
    .filter(n => typeof n.forgingConfigured !== "string")
    .sort(compareNodeQuality);

  out.push(`Status time ${state.time} | Monitoring IP: ${state.ip}`);
  out.push("");

  for (let row = 0; row < 3; ++row) {
    out.push(logTitles.map(cols => cols[row]).join("  "));
  }
  out.push("".padEnd(118, "-"));

  for (const node of readyToForge) {
    let canForgeObservation = false;
    let countdown: number | undefined;
    if (state.observation) {
      canForgeObservation = state.observation.canForge.get(node.hostname) || false;
      if (state.observation.job) {
        const job = state.observation.job;
        countdown = [...job.enable, ...job.disable].includes(node.hostname)
          ? state.observation.countdown
          : undefined;
      }
    }
    out.push(statusLine(node, canForgeObservation, countdown));
  }
  if (readyToForge.length > 0 && other.length > 0) {
    out.push("");
  }
  for (const node of other) {
    let canForgeObservation = false;
    let countdown: number | undefined;
    if (state.observation) {
      canForgeObservation = state.observation.canForge.get(node.hostname) || false;
      if (state.observation.job) {
        const job = state.observation.job;
        countdown = [...job.enable, ...job.disable].includes(node.hostname)
          ? state.observation.countdown
          : undefined;
      }
    }
    out.push(statusLine(node, canForgeObservation, countdown));
  }

  writeScreen(out);
}

export function initCommandLine() {
  console.log("".padEnd(50, "\n"));

  writeScreen(["Collecting data ..."]);
}
