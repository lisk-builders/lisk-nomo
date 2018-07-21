import * as request from 'request-promise-native';

// Lisk HTTP API
// https://app.swaggerhub.com/apis/LiskHQ/Lisk
export class LiskHttpApi {
  constructor(
    private readonly hostname: string,
    private readonly port: number,
    private readonly secure: boolean = false,
  )
  {}

  public getStatusForging(): Promise<ResponseList<ForgingStatus>> {
    return request(`${this.baseUrl()}/node/status/forging`, {json: true});
  }

  private baseUrl(): string {
    const protocol = this.secure ? "https" : "http";
    return `${protocol}://${this.hostname}:${this.port}/api`
  }
}

export interface ForgingStatus {
  forging: boolean,
  publicKey: string,
}

export interface ResponseList<T> {
  readonly meta: any;
  readonly data: T[];
}
