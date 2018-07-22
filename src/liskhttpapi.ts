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

  public getStatus(): Promise<ResponseObject<Status>> {
    return request(`${this.baseUrl()}/node/status`, {json: true});
  }

  public getStatusForging(): Promise<ResponseList<ForgingStatus>> {
    return request(`${this.baseUrl()}/node/status/forging`, {json: true})
      .then(response => {
        // handle Lisk bug https://github.com/LiskHQ/lisk/issues/2058
        if (!response.data) {
          return {
            ...response,
            data: []
          }
        }

        return response;
      });
  }

  private baseUrl(): string {
    const protocol = this.secure ? "https" : "http";
    return `${protocol}://${this.hostname}:${this.port}/api`
  }
}

export interface Status {
  readonly broadhash: string,
  readonly consensus: number,
  readonly height: number,
}

export interface ForgingStatus {
  readonly forging: boolean,
  readonly publicKey: string,
}

export interface ResponseObject<T> {
  readonly meta: any;
  readonly data: T;
}

export interface ResponseList<T> {
  readonly meta: any;
  readonly data: T[];
}
