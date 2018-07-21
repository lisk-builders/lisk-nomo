import stun = require('stun');

const { STUN_BINDING_REQUEST, STUN_ATTR_XOR_MAPPED_ADDRESS } = stun.constants

function getIpFromStunServer(stunHost: string, stunPort): Promise<string> {
  const server = stun.createServer()
  const request = stun.createMessage(STUN_BINDING_REQUEST)

  return new Promise<string>((resolve, reject) => {
    server.once('bindingResponse', stunMsg => {
      const response = stunMsg.getAttribute(STUN_ATTR_XOR_MAPPED_ADDRESS);
      if (!response) {
        reject(`Response missing from ${stunHost}`);
        return
      }

      const ip = response.value.address;
      // console.log('your ip:', ip);

      server.close();
      resolve(ip);
    });

    server.send(request, stunPort, stunHost);
  });
}

export async function getIp(): Promise<string> {
  const values = await Promise.all([
    getIpFromStunServer('stun.l.google.com', 19302),
    getIpFromStunServer('stun.stunprotocol.org', 3478),
    getIpFromStunServer('stun.dus.net', 3478),
  ]);

  const uniqueValues = new Set(values);
  if (uniqueValues.size != 1) {
    throw new Error(`Got different IP addresses: ${values} Is someone cheating on me?`);
  } else {
    // console.log('your ip:', values[0]);
    return values[0];
  }
}
