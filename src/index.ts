import { ArgumentParser } from "argparse";
import * as winston from "winston";
import Koa = require("koa");

import { displayState, initCommandLine } from "./display";
import { Manager } from "./manager";
import { MonitoredNode, MonitoredNodeEvents, OwnNode } from "./monitorednode";
import { MonitoringState } from "./monitoringstate";
import { getIp } from "./stun";

const parser = new ArgumentParser({ description: "Lisk node monitor" });
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

const ownNode: OwnNode = {
  httpPort: 3000,
  wsPort: 3001,
  nonce: randomString(16),
};

if ((args.nodes as string[]).length === 0) {
  console.error("No nodes configured for monitoring. Run with --help.");
  process.exit(1);
}

const nodes: ReadonlyArray<MonitoredNode> = (args.nodes as string[]).map(
  host => new MonitoredNode(ownNode, host, 7000, 7001),
);

let monitoringIp: string | undefined;
getIp()
  .then(i => (monitoringIp = i))
  .catch(console.warn);
setInterval(() => {
  getIp()
    .then(i => (monitoringIp = i))
    .catch(console.warn);
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
