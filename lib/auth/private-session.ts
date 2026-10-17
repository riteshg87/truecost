import type { TransportIdentity } from "../private-storage/transport";

/** Runtime-only access established by the mounted online identity verifier. */
export interface PrivateSessionAccess {
  readonly identity: Readonly<TransportIdentity>;
  readonly getToken: () => Promise<string | null>;
  /** Recheck before and after every asynchronous boundary. */
  readonly isCurrent: () => boolean;
}
