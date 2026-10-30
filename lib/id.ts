import crypto from "node:crypto";

/** Collision-resistant id shaped like Prisma's cuid (lower-case alphanumeric, starts with a letter). */
export function createId(): string {
  return `c${Date.now().toString(36)}${crypto.randomBytes(10).toString("hex")}`.slice(0, 30);
}
