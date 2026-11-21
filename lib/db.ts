import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// The PostgreSQL schema declares `directUrl = env("DIRECT_URL")` (used by migrations only); without a separate
// direct connection the pooled URL is used for both.
if (/^postgres(ql)?:\/\//i.test(process.env.DATABASE_URL ?? "") && !process.env.DIRECT_URL) process.env.DIRECT_URL = process.env.DATABASE_URL;

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
