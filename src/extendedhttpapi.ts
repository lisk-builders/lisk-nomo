import * as request from "request-promise-native";

import { HttpApi, ResponseList } from "libargus";

// Lisk HTTP API
// https://app.swaggerhub.com/apis/LiskHQ/Lisk
export class ExtendedHttpApi extends HttpApi {
  public getStatusForging(): Promise<ResponseList<ForgingStatus>> {
    return this.get(`${this.baseUrl()}/node/status/forging`);
  }

  public updateForging(
    forging: boolean,
    pubkey: string,
    password: string,
  ): Promise<ResponseList<ForgingStatus>> {
    return request
      .put(`${this.baseUrl()}/node/status/forging`, {
        json: {
          forging: forging,
          password: password,
          publicKey: pubkey,
        },
      })
      .promise();
  }
}

export interface ForgingStatus {
  readonly forging: boolean;
  readonly publicKey: string;
}
