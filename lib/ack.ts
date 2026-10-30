/** Result of a sync/autosave server action. Failures are returned (not thrown) so the client can tell
 * "retry later" (thrown network/server errors) apart from "will never succeed" and "sign in again". */
export type AckError = { ok: false; code: "UNAUTHENTICATED" | "INVALID" | "NOT_FOUND"; error: string };
export type Ack<T extends object = object> = ({ ok: true } & T) | AckError;

export const UNAUTHENTICATED: AckError = { ok: false, code: "UNAUTHENTICATED", error: "Your session has expired. Sign in again to keep saving." };

export const invalid = (error: string): AckError => ({ ok: false, code: "INVALID", error });
export const notFound = (error = "Not found."): AckError => ({ ok: false, code: "NOT_FOUND", error });
