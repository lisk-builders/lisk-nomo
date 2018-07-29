import * as request from "request-promise-native";

import { HttpApi, ResponseList } from "./external/argus/src/lib/HttpApi";

// Lisk HTTP API
// https://app.swaggerhub.com/apis/LiskHQ/Lisk
export class ExtendedHttpApi extends HttpApi {
  public getStatusForging(): Promise<ResponseList<ForgingStatus>> {
    return request(`${this.baseUrl()}/node/status/forging`, { json: true }).then(response => {
      // handle Lisk bug https://github.com/LiskHQ/lisk/issues/2058
      if (!response.data) {
        return {
          ...response,
          data: [],
        };
      }

      return response;
    });
  }

  public enableForging(pubkey: string, password: string): Promise<ResponseList<ForgingStatus>> {
    return request
      .put(`${this.baseUrl()}/node/status/forging`, {
        json: {
          forging: true,
          password: password,
          publicKey: pubkey,
        },
      })
      .promise();
  }

  public disableForging(pubkey: string, password: string): Promise<ResponseList<ForgingStatus>> {
    return request
      .put(`${this.baseUrl()}/node/status/forging`, {
        json: {
          forging: false,
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
