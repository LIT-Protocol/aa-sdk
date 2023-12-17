import { PKPEthersWallet } from "@lit-protocol/pkp-ethers";
import { LitAbility, LitPKPResource } from "@lit-protocol/auth-helpers";
import {
  type AuthCallbackParams,
  type AuthSig,
  type SessionSigsMap,
} from "@lit-protocol/types";
import { LitNodeClient } from "@lit-protocol/lit-node-client";
import { ALL_LIT_CHAINS } from "@lit-protocol/constants";
import { generateSessionKeyPair } from "@lit-protocol/crypto";
import { type SignTypedDataParams } from "@alchemy/aa-core";
import type { Address, TypedDataDomain } from "viem";
import {
  type LitAuthMethod,
  type LitSessionSigsMap,
  type LitConfig,
  type LitAuthenticateProps,
  type LitSmartAccountAuthenticator,
  type LitUserMetadata,
} from "./types.js";
import { signerTypePrefix } from "../constants.js";

const SIGNER_TYPE: string = `${signerTypePrefix}lit`;

/**
 * Implementation of `SmartAccountAuthenticator` for lit protocol
 * This class requies:
 * `@lit-protocol/lit-node-client@cayenne`
 * `@lit-protocol/pkp-ethers@cayenne`
 * `@lit-protocol/crypto@cayenne`
 * `@lit-protocol/auth-helpers@cayenne`
 * `@lit-protocol/types@cayenne`
 */
export class LitSigner<C extends LitAuthMethod | LitSessionSigsMap>
  implements LitSmartAccountAuthenticator<C>
{
  inner: LitNodeClient;
  public signer: PKPEthersWallet | undefined;
  private _pkpPublicKey: string;
  private _rpcUrl: string;
  private _authContext: C | undefined;
  public session: SessionSigsMap | undefined;

  constructor(params: LitConfig) {
    this._pkpPublicKey = params.pkpPublicKey;
    this.inner =
      params.inner ??
      new LitNodeClient({
        litNetwork: params.network ?? "cayenne",
        debug: params.debug ?? false,
      });
    this._rpcUrl = params.rpcUrl;
  }
  signerType: string = SIGNER_TYPE;

  /**
   * if generic type is `LitAuthMethod`, authenticates the supplied authentication material.
   * if type `SessionSigsMap`, this implementation will respect the existing auth and use the session material.
   * @param props {LITAuthenticateProps} Authentication params, only `context` is required
   * @returns {Promise<LitSessionSigsMap>} Authenticated session material
   * @throws {Not Authenticated} if authentication operations fail this error is thrown
   */
  authenticate = async (
    props: LitAuthenticateProps<C>
  ): Promise<LitUserMetadata> => {
    if (!this.session) {
      // runs authentication logic
      await this._doAuthentication(props);
    }

    // check on internal state for authentication status
    if (!this.session) {
      throw new Error("Not Authenticated");
    }

    return this.session;
  };

  getAuthDetails = async (): Promise<LitUserMetadata> => {
    this._checkInternals();
    return this._authContext as LitSessionSigsMap;
  };

  getAddress = async () => {
    this._checkInternals();
    const address = await this.signer?.getAddress();

    return address as `0x${string}`;
  };

  signMessage = async (msg: Uint8Array | string) => {
    this._checkInternals();

    return this.signer?.signMessage(msg) as Promise<Hex>;
  };

  signTypedData = (params: SignTypedDataParams) => {
    this._checkInternals();

    return this.signer?._signTypedData(
      params.domain as TypedDataDomain,
      params.types as any,
      params.message
    ) as Promise<Address>;
  };

  private _checkInternals() {
    if (!this._authContext) {
      throw new Error("Not Authenticated");
    }

    if (!this.signer) {
      throw new Error("Signer is not initalized, did you call authenticate?");
    }
  }

  /**
   * Runs the Lit Protocol authentication operations for a given piece of authentication material
   * 
   * AuthMethod -> authenticates the auth material and signs a session.
   * 
   * SessionSigsMap -> uses the session to create a signer instance. 
   * 
   * For more information on Lit Authentication see below:
   * 
   * https://developer.litprotocol.com/v3/sdk/authentication/overview
   * @param props {LitAuthenticationProps<C>} properties for configuring authentication operations  
  */
  private async _doAuthentication(props: LitAuthenticateProps<C>) {
    /**
     * Check if the object is structed as an auth method
     * if so we sign the session key with the auth method
     * as the auth material. If a session signature
     * is provided then we skip this step.
     */
    if (Object.keys(props.context).indexOf("accessToken") > 0) {
      const resourceAbilities = [
        {
          resource: new LitPKPResource("*"),
          ability: LitAbility.PKPSigning,
        },
      ];
      const sessionKeypair = props.sessionKeypair || generateSessionKeyPair();
      const chain = props.chain || "ethereum";
      const chainInfo = ALL_LIT_CHAINS[chain];
      // @ts-expect-error - chainId is not defined on the type
      const chainId = chainInfo.chainId ?? 1;
      let authNeededCallback: any;
      if (props.context?.authMethodType === 1) {
        authNeededCallback = async (params: AuthCallbackParams) => {
          const response = await this.inner.signSessionKey({
            statement: params.statement,
            authMethods: [props.context as LitAuthMethod],
            authSig: JSON.parse(props.context.accessToken as string) as AuthSig,
            pkpPublicKey: `0x${this._pkpPublicKey}`,
            expiration: params.expiration,
            resources: params.resources,
            chainId: chainId,
          });
          return response.authSig;
        };
      } else {
        authNeededCallback = async (params: AuthCallbackParams) => {
          const response = await this.inner.signSessionKey({
            statement: params.statement,
            sessionKey: sessionKeypair,
            authMethods: [props.context as LitAuthMethod],
            pkpPublicKey: `0x${this._pkpPublicKey}`,
            expiration: params.expiration,
            resources: params.resources,
            chainId: chainId,
          });
          return response.authSig;
        };
      }

      if (!this.inner.ready) {
        await this.inner.connect();
      }

      const sessionSigs = await this.inner
        .getSessionSigs({
          chain,
          expiration:
            props.expiration ??
            // set default exp to 1 week if not provided
            new Date(Date.now() + 60 * 60 * 24 * 7).toISOString(),
          resourceAbilityRequests: resourceAbilities,
          authNeededCallback,
        })
        .catch((err) => {
          throw err;
        });

      this._authContext = props.context;
      this.session = sessionSigs;

      this.signer = new PKPEthersWallet({
        pkpPubKey: this._pkpPublicKey,
        rpc: this._rpcUrl,
        controllerSessionSigs: sessionSigs as LitSessionSigsMap,
      });

      await this.signer.init();
    } else {
      this._authContext = props.context;
      this.session = props.context as SessionSigsMap;

      this.signer = new PKPEthersWallet({
        pkpPubKey: this._pkpPublicKey,
        rpc: this._rpcUrl,
        controllerSessionSigs: this._authContext as LitSessionSigsMap,
      });

      await this.signer.init();
    }
  }
}
