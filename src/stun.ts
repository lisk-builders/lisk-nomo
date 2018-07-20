import stun = require('stun');

const { STUN_BINDING_REQUEST, STUN_ATTR_XOR_MAPPED_ADDRESS } = stun.constants

export function getIp(): Promise<string> {
  const server = stun.createServer()
  const request = stun.createMessage(STUN_BINDING_REQUEST)
  
  return new Promise<string>((resolve, reject) => {
    server.once('bindingResponse', stunMsg => {
      const ip = stunMsg.getAttribute(STUN_ATTR_XOR_MAPPED_ADDRESS).value.address;
      // console.log('your ip:', ip);

      server.close();
      resolve(ip);
    });
        
    server.send(request, 19302, 'stun.l.google.com');
  });
}
