/**
 * tokenHelper.ts
 * Generates signed JWT tokens for test requests — mirrors the format
 * produced by the real auth routes.
 */

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export type TestRole = 'EMPLOYEE' | 'ADMIN' | 'MANAGER';

export function makeToken(
    role: TestRole,
    id    = 'test-user-id',
    email = `${role.toLowerCase()}@test.com`,
): string {
    return jwt.sign({ id, email, role }, JWT_SECRET, { expiresIn: '1h' });
}

/** Pre-built bearer header strings for convenience in supertest. */
export const employeeToken = () => `Bearer ${makeToken('EMPLOYEE')}`;
export const adminToken    = () => `Bearer ${makeToken('ADMIN')}`;
export const managerToken  = () => `Bearer ${makeToken('MANAGER')}`;
