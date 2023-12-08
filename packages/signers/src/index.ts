export { MagicSigner, type MagicAuthParams } from "./magic/index.js";
export { TurnkeySigner, type TurnkeyAuthParams } from "./turnkey/index.js";
export {
  Web3AuthSigner,
  type Web3AuthAuthenticationParams,
} from "./web3auth/index.js";

export {
  LitSigner,
  type LitAccountAuthenticatorParams,
  type LITAuthenticateProps,
  type LitAuthMethod,
  type LitSessionSigsMap,
} from "./lit-protocol/index.js";
