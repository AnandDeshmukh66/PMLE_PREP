/** In-memory stand-in for next/headers: one "browser" cookie jar and request headers, switchable by tests. */
type Cookie = { name: string; value: string; maxAge?: number; expires?: Date; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string };

export type Jar = Map<string, Cookie>;
const g = globalThis as unknown as { __jar: Jar; __headers: Headers };
g.__jar ??= new Map();
g.__headers ??= new Headers({ host: "localhost:3000" });

export function activateJar(jar: Jar) {
  g.__jar = jar;
}
export function setRequestHeaders(h: Record<string, string>) {
  g.__headers = new Headers({ host: "localhost:3000", ...h });
}

export async function cookies() {
  const jar = g.__jar;
  return {
    get: (name: string) => jar.get(name),
    getAll: () => [...jar.values()],
    has: (name: string) => jar.has(name),
    set: (name: string, value: string, opts: Omit<Cookie, "name" | "value"> = {}) => {
      if (opts.maxAge === 0 || value === "") jar.delete(name);
      else jar.set(name, { name, value, ...opts });
    },
    delete: (name: string) => jar.delete(name),
  };
}

export async function headers() {
  return g.__headers;
}
