# lisk-nomo

Node monitor for nomo downtime.

Lisk Nomo is tailored for the new Lisk Core 1.x release and utilizes the power
of WebSockets.

## Prerequisites

Requires Node.js 8 or above.

I prefer yarn but npm should work too. All examples will use yarn.

```
$ git clone --recursive https://github.com/prolina-foundation/lisk-nomo
$ cd lisk-nomo
$ yarn install
```

## First run

Monitor a bunch of nodes:

```
$ yarn start testnet.lisk.io node01.testnet.lisk node02.testnet.lisk node03.testnet.lisk
```

and see the magic happen

```
Status time 2018-08-02T19:03:19.782Z | Monitoring IP: 36.176.219.178

                                                    est.   WS                      WS/API   con
                                                    clock  height/                 best     sen
                        ping   socket   version     diff   chain           API     height   sus  forging
--------------------------------------------------------------------------------------------------------
testnet.lisk.io          24ms  online   1.0.0-rc.1   26ms  5877782/a1b224  HTTP    5877782   90  unknown
node01.testnet.lisk      14ms  online   1.0.0-rc.1   22ms  5877782/a1b224  closed  5877782    ?  unknown
node02.testnet.lisk      30ms  online   1.0.0-rc.1   32ms  5877782/a1b224  closed  5877782    ?  unknown
node03.testnet.lisk      16ms  online   1.0.0-rc.1   13ms  5877782/a1b224  closed  5877782    ?  unknown
```

| Field              | Description                                   |
| ------------------ | --------------------------------------------- |
| ping               | A TCP/IP ping to the node's WebSocket port    |
| socket             | Online/offline status                         |
| version            | The node's version of Lisk core               |
| est. clock diff    | An rough estimation of the system clock difference beween monitor and node. Typical values are -10ms to 150ms. A diff less than -100ms or greater than 500ms means that the node's clock is probably not synced. |
| WS height/chain    | The height we get from the Websocket connection and a prefix of the broadhash |
| API                | API access: HTTPs, HTTP or closed. Add the monitoring IP to api.access.whitelist in the node's config.json to get data |
| WS/API best height | The best height we know of the node           |
| consensus          | Broadhash consensus in %                      |
| forging            | The forging status. Add the monitoring IP to forging.access.whitelist in the node's config.json to get data |

Ensure you whitelist the monitoring IP in all your nodes to get the forging status of your nodes, e.g.

```
Status time 2018-08-02T19:22:05.984Z | Monitoring IP: 36.176.219.178

                                                    est.   WS                      WS/API   con
                                                    clock  height/                 best     sen
                        ping   socket   version     diff   chain           API     height   sus  forging
-----------------------------------------------------------------------------------------------------------
node01.testnet.lisk      14ms  online   1.0.0-rc.1   13ms  5877886/02cc27  HTTP    5877886   89  configured
node02.testnet.lisk      30ms  online   1.0.0-rc.1   33ms  5877886/02cc27  HTTP    5877886   99  configured
node03.testnet.lisk      15ms  online   1.0.0-rc.1    5ms  5877886/02cc27  HTTP    5877886   92  configured

testnet.lisk.io          24ms  online   1.0.0-rc.1   34ms  5877886/02cc27  HTTP    5877886   85  unknown
```

## Auto-enable forging

As you can see, all my personal nodes are configured for forging but non is forging yet.
When you start with the `--password` parameter, the monitor will auto-select a node for forging and activate it.

```
$ yarn start --password 87654321 testnet.lisk.io node01.testnet.lisk node02.testnet.lisk node03.testnet.lisk
```

After some seconds to collect data and get warm, the manager decided to activate
forging on one of the ready nodes.

```
Status time 2018-08-02T19:26:55.343Z | Monitoring IP: 36.176.219.178

                                                    est.   WS                      WS/API   con
                                                    clock  height/                 best     sen
                        ping   socket   version     diff   chain           API     height   sus  forging
----------------------------------------------------------------------------------------------------------------------
node01.testnet.lisk      14ms  online   1.0.0-rc.1   17ms  5877909/287cc1  HTTP    5877909   99  forging         ready
node02.testnet.lisk      31ms  online   1.0.0-rc.1   33ms  5877909/287cc1  HTTP    5877909   97  configured      ready
node03.testnet.lisk      15ms  online   1.0.0-rc.1   18ms  5877909/287cc1  HTTP    5877909  100  configured      ready

testnet.lisk.io          24ms  online   1.0.0-rc.1   36ms  5877909/287cc1  HTTP    5877909   90  unknown
```

Happy forging!

## License

MIT, see LICENSE.

This repo bundles a copy of Lisk Argus by Hendrik Hofstadt & Lisk Builders
licensed under MIT.
