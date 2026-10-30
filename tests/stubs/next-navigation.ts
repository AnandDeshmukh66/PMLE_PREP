/** next/navigation stand-in: redirect/notFound throw like Next does, so tests can assert on them. */
export class RedirectSignal extends Error {
  constructor(public url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
export function redirect(url: string): never {
  throw new RedirectSignal(url);
}
export function notFound(): never {
  throw new Error("NEXT_NOT_FOUND");
}
