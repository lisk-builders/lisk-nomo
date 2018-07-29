import { MonitoredNode, OwnNode, ApiStatus, Chain, MonitoredNodeEvents } from "./monitorednode";
import { getIp } from "./stun";
import { logStatus } from "./display";
import { Manager } from "./manager";

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

const nodes: ReadonlyArray<MonitoredNode> = [
  new MonitoredNode("node01.testnet.lisk", ownNode),
  new MonitoredNode("node02.testnet.lisk", ownNode),
  new MonitoredNode("wiki.lisk.prolina.org", ownNode),
  new MonitoredNode("testnet.lisk.io", ownNode),
];

let ip: string | undefined;
getIp()
  .then(i => (ip = i))
  .catch(console.warn);
setInterval(() => {
  getIp()
    .then(i => (ip = i))
    .catch(console.warn);
}, 60 * 1000);


let lastOutput = 0;
for (const node of nodes) {
  node.on(MonitoredNodeEvents.Updated, () => {
    if (Date.now() - lastOutput > 500) {
      logStatus(nodes, ip);
      lastOutput = Date.now();
    }
  });
}
