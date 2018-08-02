import { MonitoredNode, OwnNode, ApiStatus, Chain, MonitoredNodeEvents } from "./monitorednode";
import { getIp } from "./stun";
import { logStatus } from "./display";
import { Manager } from "./manager";

import { ArgumentParser } from "argparse";

const parser = new ArgumentParser({ description: "Lisk node monitor" });
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
let lastOutput = 0;
for (const node of nodes) {
  node.on(MonitoredNodeEvents.Updated, () => {
    let observation = manager ? manager.observe(nodes) : undefined;

    if (Date.now() - lastOutput > 500) {
      logStatus(nodes, observation, monitoringIp);
      lastOutput = Date.now();
    }
  });
}
