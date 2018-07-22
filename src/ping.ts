import tcpPing = require("tcp-ping");

export class Ping {
  constructor(private host: string, private port: number) {}

  public run(): Promise<PingResponse> {
    return new Promise((resolve, reject) => {
      tcpPing.ping({ address: this.host, port: this.port }, (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(data);
        }
      });
    });
  }
}

export interface PingSingleAttemptResult {
  readonly seq: number;
  readonly time: number;
}

export interface PingResponse {
  readonly address: string;
  readonly port: number;
  readonly attempts: number;
  readonly avg: number;
  readonly max: number;
  readonly min: number;
  readonly results: PingSingleAttemptResult[];
}
