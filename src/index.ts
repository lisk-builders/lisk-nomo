import { ArgumentParser } from "argparse";
import { OwnNodeOptions } from "libargus";
import * as winston from "winston";
import Koa = require("koa");

import { displayState, initCommandLine } from "./display";
import { Manager } from "./manager";
import { MonitoredNode, MonitoredNodeEvents } from "./monitorednode";
import { MonitoringState } from "./monitoringstate";
import { getIp } from "./stun";

const parser = new ArgumentParser({ description: "Lisk node monitor" });
parser.addArgument("--network", {
  choices: ["mainnet", "testnet"],
  defaultValue: "mainnet",
  help: "Lisk network to use (mainnet or testnet)",
});
parser.addArgument("--apiPort", { help: "set to enable nomo REST API" });
parser.addArgument("--password", { help: "the password to enable/disable forging" });
parser.addArgument("nodes", {
  nargs: "*",
  metavar: "node",
  help: "nodes to monitor (IP or hostname)",
});
const args = parser.parseArgs();

function randomCharacter(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return alphabet[Math.floor(Math.random() * alphabet.length)];
}

function randomString(length: number): string {
  return Array.from({ length: length })
    .map(() => randomCharacter())
    .join("");
}

const ownNode: OwnNodeOptions = {
  httpPort: 3000,
  wsPort: 3001,
  nonce: randomString(16),
  os: "linux",
  version: "1.1.0",
};

if ((args.nodes as string[]).length === 0) {
  console.error("No nodes configured for monitoring. Run with --help.");
  process.exit(1);
}

let nodesHttpsPort: number;
let nodesHttpPort: number;
let nodesWsPort: number;
let nethash: string;

switch (args.network as string) {
  case "mainnet":
    nodesHttpsPort = 443;
    nodesHttpPort = 8000;
    nodesWsPort = 8001;
    nethash = "ed14889723f24ecc54871d058d98ce91ff2f973192075c0155ba2b7b70ad2511";
    break;
  case "testnet":
    nodesHttpsPort = 443;
    nodesHttpPort = 7000;
    nodesWsPort = 7001;
    nethash = "da3ed6a45429278bac2666961289ca17ad86595d33b31037615d4b8e8f158bba";
    break;
  default:
    throw Error("Unknown network");
}

const nodes: ReadonlyArray<MonitoredNode> = (args.nodes as string[]).map(
  host => new MonitoredNode(ownNode, host, nodesHttpsPort, nodesHttpPort, nodesWsPort, nethash),
);

let monitoringIp: string | undefined;
getIp()
  .then(i => (monitoringIp = i))
  .catch(error => {
    monitoringIp = undefined;
    winston.warn(error);
  });
setInterval(() => {
  getIp()
    .then(i => (monitoringIp = i))
    .catch(error => {
      monitoringIp = undefined;
      winston.warn(error);
    });
}, 60 * 1000);

const manager = args.password ? new Manager(nodes, args.password) : undefined;

function getCurrentState(): MonitoringState {
  const nodeStati = nodes.map(n => n.status);
  const observation = manager ? manager.observe(nodeStati) : undefined;
  return {
    time: new Date(Date.now()).toISOString(),
    ip: monitoringIp,
    observation: observation,
    nodes: nodeStati,
  };
}

let lastOutput = 0;
for (const node of nodes) {
  node.on(MonitoredNodeEvents.Updated, () => {
    if (Date.now() - lastOutput > 250) {
      let state = getCurrentState();
      displayState(state);
      lastOutput = Date.now();
    }
  });
}

const logFile = new winston.transports.File({ filename: "nomo.log" });
winston.add(logFile);

initCommandLine();

if (args.apiPort) {
  const api = new Koa();

  api.use(async context => {
    switch (context.path) {
      case "/state":
        const state = getCurrentState();
        context.response.body = state;
        break;
      default:
      // koa sends 404 by default
    }
  });

  api.listen(args.apiPort);
}
