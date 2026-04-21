/**
 * Non-Functional Tests — TrackNFix Backend
 *
 * Non-functional testing validates system qualities beyond "does it work":
 *
 *  1. Security
 *     - All protected routes enforce JWT authentication (no token → 401)
 *     - Role-based access control is applied system-wide (wrong role → 403)
 *     - Expired / tampered tokens are rejected
 *     - Input validation prevents invalid data from reaching the database
 *
 *  2. Performance
 *     - API endpoints respond within an acceptable time threshold (< 300 ms)
 *       even under in-process mocking conditions
 *
 *  3. Reliability & Error Handling
 *     - Database errors surface as 500 responses with a consistent error envelope
 *     - No endpoint crashes the process (unhandled rejections are caught)
 *
 *  4. Input Validation / Boundary Conditions
 *     - Empty strings, extreme numbers, and wrong types are rejected cleanly
 *     - Missing required fields return actionable 400 messages
 */

// ── Prisma mock ───────────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
    __esModule: true,
    default: {
        user:              { findUnique: jest.fn(), create: jest.fn(), count: jest.fn() },
        vehicle:           { findUnique: jest.fn(), create: jest.fn() },
        job:               { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
        quotation:         { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        quotationItem:     { createMany: jest.fn(), deleteMany: jest.fn() },
        sparePart:         { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn() },
        stockLedger:       { create: jest.fn(), findMany: jest.fn() },
        attendanceRequest: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
        attendance:        { findFirst: jest.fn(), findMany: jest.fn() },
        leave:             { findFirst: jest.fn(), findMany: jest.fn() },
        overtime:          { findFirst: jest.fn() },
        holiday:           { findFirst: jest.fn(), findMany: jest.fn() },
        notification:      { create: jest.fn() },
        $transaction:      jest.fn(),
    },
}));

// ── Nodemailer mock ───────────────────────────────────────────────────────────
jest.mock('nodemailer', () => ({
    createTransport: () => ({ sendMail: jest.fn().mockResolvedValue({}) }),
}));

import request from 'supertest';
import jwt     from 'jsonwebtoken';
import app     from './__mocks__/testAppNF';
import prisma  from '../lib/prisma';
import { adminToken, managerToken, employeeToken } from './helpers/tokenHelper';

const db = prisma as any;

beforeEach(() => jest.clearAllMocks());

// ════════════════════════════════════════════════════════════════════════════════
// 1. SECURITY — Authentication Enforcement
// ════════════════════════════════════════════════════════════════════════════════

describe('[Security] Authentication — all protected routes require a valid JWT', () => {
    /**
     * Every route that requires login must return 401 when no token is provided.
     * This ensures no endpoint is accidentally left open.
     */
    const protectedRoutes = [
        { method: 'post',  path: '/api/auth/change-password' },
        { method: 'post',  path: '/api/jobs'                 },
        { method: 'get',   path: '/api/jobs'                 },
        { method: 'get',   path: '/api/employees'            },
        { method: 'post',  path: '/api/employees'            },
        { method: 'get',   path: '/api/quotations'           },
        { method: 'get',   path: '/api/inventory'            },
        { method: 'get',   path: '/api/attendance/today'     },
        { method: 'get',   path: '/api/attendance/my'        },
        { method: 'post',  path: '/api/attendance/checkin'   },
    ];

    protectedRoutes.forEach(({ method, path }) => {
        test(`401 — ${method.toUpperCase()} ${path} without Authorization header`, async () => {
            const res = await (request(app) as any)[method](path).send({});
            expect(res.status).toBe(401);
            expect(res.body).toHaveProperty('error', 'No token provided');
        });
    });
});

// ── Tampered & expired token rejection ────────────────────────────────────────

describe('[Security] JWT integrity — tampered and expired tokens are rejected', () => {
    test('401 — completely invalid token string is rejected', async () => {
        const res = await request(app)
            .get('/api/jobs')
            .set('Authorization', 'Bearer not.a.real.jwt');

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error', 'Invalid token');
    });

    test('401 — token signed with a different secret is rejected', async () => {
        // Signed with 'wrong-secret' instead of the app's JWT_SECRET
        const forgedToken = jwt.sign(
            { id: 'hacker', role: 'ADMIN', email: 'h@x.com' },
            'wrong-secret',
        );

        const res = await request(app)
            .get('/api/jobs')
            .set('Authorization', `Bearer ${forgedToken}`);

        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid token/i);
    });

    test('401 — expired token is rejected', async () => {
        // Issue a token that is already 1 second past its expiry
        const expiredToken = jwt.sign(
            { id: 'uid-1', role: 'EMPLOYEE', email: 'e@test.com' },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: -1 },
        );

        const res = await request(app)
            .get('/api/jobs')
            .set('Authorization', `Bearer ${expiredToken}`);

        expect(res.status).toBe(401);
    });
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. SECURITY — Role-Based Access Control
// ════════════════════════════════════════════════════════════════════════════════

describe('[Security] Role-based access control — cross-role access is blocked', () => {
    test('403 — EMPLOYEE cannot access admin inventory (manager-only)', async () => {
        const res = await request(app)
            .get('/api/inventory')
            .set('Authorization', employeeToken());
        expect(res.status).toBe(403);
    });

    test('403 — ADMIN cannot access inventory (manager-only)', async () => {
        const res = await request(app)
            .get('/api/inventory')
            .set('Authorization', adminToken());
        expect(res.status).toBe(403);
    });

    test('403 — EMPLOYEE cannot create a quotation (admin/manager only)', async () => {
        const res = await request(app)
            .post('/api/quotations')
            .set('Authorization', employeeToken())
            .send({ vehicleNumber: 'WP-ABC-1234', telephone: '0711234567' });
        expect(res.status).toBe(403);
    });

    test('403 — MANAGER cannot create employees (admin-only)', async () => {
        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', managerToken())
            .send({});
        expect(res.status).toBe(403);
    });

    test('403 — EMPLOYEE cannot access manager attendance overview', async () => {
        const res = await request(app)
            .get('/api/attendance/manager/overview')
            .set('Authorization', employeeToken());
        expect(res.status).toBe(403);
    });
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. PERFORMANCE — Response Time
// ════════════════════════════════════════════════════════════════════════════════

describe('[Performance] Response time — endpoints respond within 300 ms', () => {
    /**
     * Measures wall-clock time for each request.
     * With mocked Prisma, all DB latency is eliminated — if a route takes longer
     * than 300 ms it suggests a logic bottleneck, not a DB problem.
     */

    test('GET /api/health responds in under 300 ms', async () => {
        const start = Date.now();
        await request(app).get('/api/health');
        expect(Date.now() - start).toBeLessThan(300);
    });

    test('POST /api/auth/signin (invalid creds path) responds in under 300 ms', async () => {
        db.user.findUnique.mockResolvedValue(null);
        const start = Date.now();
        await request(app).post('/api/auth/signin').send({ email: 'x@x.com', password: 'y' });
        expect(Date.now() - start).toBeLessThan(300);
    });

    test('GET /api/jobs (authenticated, empty result) responds in under 300 ms', async () => {
        db.job.findMany.mockResolvedValue([]);
        const start = Date.now();
        await request(app).get('/api/jobs').set('Authorization', employeeToken());
        expect(Date.now() - start).toBeLessThan(300);
    });

    test('GET /api/inventory/search?q=oil (authenticated) responds in under 300 ms', async () => {
        db.sparePart.findMany.mockResolvedValue([]);
        const start = Date.now();
        await request(app)
            .get('/api/inventory/search?q=oil')
            .set('Authorization', managerToken());
        expect(Date.now() - start).toBeLessThan(300);
    });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. RELIABILITY — Database Error Handling
// ════════════════════════════════════════════════════════════════════════════════

describe('[Reliability] Database error handling — 500 responses have consistent shape', () => {
    /**
     * If Prisma throws an unexpected error, the route should catch it and return
     * a 500 with { error: '...' } — never crash the process or expose stack traces.
     */

    test('POST /api/jobs — DB failure returns 500 with error key', async () => {
        db.vehicle.findUnique.mockRejectedValue(new Error('DB connection lost'));

        const res = await request(app)
            .post('/api/jobs')
            .set('Authorization', employeeToken())
            .send({ vehicleNumber: 'WP-ABC-1234', jobType: 'SERVICE' });

        expect(res.status).toBe(500);
        expect(res.body).toHaveProperty('error');
    });

    test('GET /api/inventory — DB failure returns 500 with error key', async () => {
        db.sparePart.findMany.mockRejectedValue(new Error('Query timeout'));

        const res = await request(app)
            .get('/api/inventory')
            .set('Authorization', managerToken());

        expect(res.status).toBe(500);
        expect(res.body).toHaveProperty('error');
    });

    test('GET /api/quotations — DB failure returns 500 with error key', async () => {
        db.quotation.findMany.mockRejectedValue(new Error('Unexpected error'));

        const res = await request(app)
            .get('/api/quotations')
            .set('Authorization', adminToken());

        expect(res.status).toBe(500);
        expect(res.body).toHaveProperty('error');
    });
});

// ════════════════════════════════════════════════════════════════════════════════
// 5. INPUT VALIDATION — Boundary & Edge Cases
// ════════════════════════════════════════════════════════════════════════════════

describe('[Input Validation] Boundary conditions and type safety', () => {
    test('POST /api/auth/signin — email with invalid format returns 400', async () => {
        const res = await request(app)
            .post('/api/auth/signin')
            .send({ email: 'not-an-email', password: 'pass' });

        expect(res.status).toBe(400);
    });

    test('POST /api/auth/signup — password shorter than 6 chars returns 400', async () => {
        const res = await request(app)
            .post('/api/auth/signup')
            .send({ name: 'Test', email: 't@t.com', password: '123', role: 'ADMIN' });

        expect(res.status).toBe(400);
    });

    test('POST /api/jobs — empty vehicleNumber string returns 400', async () => {
        const res = await request(app)
            .post('/api/jobs')
            .set('Authorization', employeeToken())
            .send({ vehicleNumber: '', jobType: 'SERVICE' });

        expect(res.status).toBe(400);
    });

    test('POST /api/jobs — completely empty body returns 400', async () => {
        const res = await request(app)
            .post('/api/jobs')
            .set('Authorization', employeeToken())
            .send({});

        expect(res.status).toBe(400);
    });

    test('POST /api/inventory — negative boughtPrice returns 400', async () => {
        const res = await request(app)
            .post('/api/inventory')
            .set('Authorization', managerToken())
            .send({
                name: 'Part', serialNumber: 'SN-001',
                boughtPrice: -100, // invalid
                sellingPrice: 200, quantity: 5,
            });

        expect(res.status).toBe(400);
    });

    test('POST /api/inventory — fractional quantity returns 400 (must be integer)', async () => {
        const res = await request(app)
            .post('/api/inventory')
            .set('Authorization', managerToken())
            .send({
                name: 'Part', serialNumber: 'SN-002',
                boughtPrice: 100, sellingPrice: 200,
                quantity: 3.5, // non-integer
            });

        expect(res.status).toBe(400);
    });

    test('POST /api/auth/verify-otp — OTP shorter than 6 digits returns 400', async () => {
        const res = await request(app)
            .post('/api/auth/verify-otp')
            .send({ email: 'user@test.com', otp: '123' }); // too short

        expect(res.status).toBe(400);
    });

    test('POST /api/auth/verify-otp — OTP longer than 6 digits returns 400', async () => {
        const res = await request(app)
            .post('/api/auth/verify-otp')
            .send({ email: 'user@test.com', otp: '1234567' }); // too long

        expect(res.status).toBe(400);
    });
});

// ════════════════════════════════════════════════════════════════════════════════
// 6. SECURITY — Sensitive Data Not Exposed
// ════════════════════════════════════════════════════════════════════════════════

describe('[Security] Sensitive data — passwords and secrets are never returned', () => {
    test('POST /api/auth/signin — response does not include password hash', async () => {
        const bcrypt = require('bcryptjs');
        const hashed = await bcrypt.hash('mypassword', 10);

        db.user.findUnique.mockResolvedValue({
            id: 'uid-1', name: 'Admin', email: 'a@test.com',
            password: hashed, role: 'ADMIN', isActive: true, isFirstLogin: false,
        });

        const res = await request(app)
            .post('/api/auth/signin')
            .send({ email: 'a@test.com', password: 'mypassword' });

        expect(res.status).toBe(200);
        // The password hash must NEVER appear in the response body
        expect(res.body.user).not.toHaveProperty('password');
        expect(JSON.stringify(res.body)).not.toContain(hashed);
    });

    test('POST /api/employees — response does not include password hash', async () => {
        db.user.findUnique.mockResolvedValue(null);
        db.user.create.mockResolvedValue({
            id: 'emp-new', name: 'Bob', email: 'b@test.com',
            nicNumber: '199512345678', address: '10 St',
            isActive: true, isFirstLogin: true, createdAt: new Date(),
            // Note: password field is intentionally omitted — select clause in the route
        });

        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', adminToken())
            .send({
                name: 'Bob', email: 'b@test.com', nicNumber: '199512345678',
                address: '10 St', password: 'temp1234',
            });

        expect(res.status).toBe(201);
        expect(res.body).not.toHaveProperty('password');
    });
});
