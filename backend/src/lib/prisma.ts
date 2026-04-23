/**
 * prisma.ts — Prisma Client Singleton
 *
 * Exports a single shared PrismaClient instance so that every route module
 * reuses the same database connection pool instead of opening a new one.
 *
 * Importing this module in multiple files is safe because Node.js caches
 * module exports — the `new PrismaClient()` constructor runs exactly once
 * for the lifetime of the process.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;
