/**
 * Integration tests — Employee routes (/api/employees)
 *
 * Verifies that:
 *   - GET /api/employees  is accessible to ADMIN and MANAGER, not EMPLOYEE
 *   - POST /api/employees only ADMIN can create; rejects duplicates and invalid input
 *   - PATCH /api/employees/:id/status only ADMIN can toggle; validates isActive boolean
 */

// ── Prisma mock ───────────────────────────────────────────────────────────────
jest.mock('../../lib/prisma', () => ({
    __esModule: true,
    default: {
        user: {
            findMany:  jest.fn(),
            findUnique: jest.fn(),
            create:    jest.fn(),
            update:    jest.fn(),
        },
    },
}));

import request from 'supertest';
import app     from '../helpers/testApp';
import prisma  from '../../lib/prisma';
import { adminToken, managerToken, employeeToken } from '../helpers/tokenHelper';

const db = prisma as unknown as {
    user: {
        findMany:   jest.Mock;
        findUnique: jest.Mock;
        create:     jest.Mock;
        update:     jest.Mock;
    };
};

beforeEach(() => jest.clearAllMocks());

// ── GET /api/employees ────────────────────────────────────────────────────────

describe('GET /api/employees — list employees', () => {
    const sampleEmployees = [
        {
            id: 'emp-1', name: 'Alice', email: 'alice@test.com',
            nicNumber: '199012345678', address: '10 Main St', isActive: true,
            isFirstLogin: false, createdAt: new Date(), _count: { jobs: 3 },
        },
    ];

    test('200 — admin can list all employees with job count', async () => {
        db.user.findMany.mockResolvedValue(sampleEmployees);

        const res = await request(app)
            .get('/api/employees')
            .set('Authorization', adminToken());

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body[0]).toHaveProperty('_count');
        expect(res.body[0]._count.jobs).toBe(3);
    });

    test('200 — manager can also list employees (read-only access)', async () => {
        db.user.findMany.mockResolvedValue(sampleEmployees);

        const res = await request(app)
            .get('/api/employees')
            .set('Authorization', managerToken());

        expect(res.status).toBe(200);
    });

    test('403 — employee cannot list other employees', async () => {
        const res = await request(app)
            .get('/api/employees')
            .set('Authorization', employeeToken());

        expect(res.status).toBe(403);
    });

    test('401 — unauthenticated request is rejected', async () => {
        const res = await request(app).get('/api/employees');
        expect(res.status).toBe(401);
    });
});

// ── POST /api/employees — create employee ─────────────────────────────────────

describe('POST /api/employees — create employee (Admin only)', () => {
    const validPayload = {
        name: 'Bob Silva',
        email: 'bob@test.com',
        nicNumber: '199512345678',
        address: '45 Lake Road, Kandy',
        password: 'temp1234',
    };

    test('201 — admin creates a new employee with isFirstLogin = true', async () => {
        db.user.findUnique.mockResolvedValue(null); // email and NIC not taken
        db.user.create.mockResolvedValue({
            id: 'emp-new', name: 'Bob Silva', email: 'bob@test.com',
            nicNumber: '199512345678', address: '45 Lake Road, Kandy',
            isActive: true, isFirstLogin: true, createdAt: new Date(),
        });

        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', adminToken())
            .send(validPayload);

        expect(res.status).toBe(201);
        expect(res.body.isFirstLogin).toBe(true); // Forces password change on first login
        expect(res.body).not.toHaveProperty('password'); // Password hash must never be returned
    });

    test('400 — duplicate email is rejected', async () => {
        db.user.findUnique
            .mockResolvedValueOnce({ id: 'existing' }); // email already exists

        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', adminToken())
            .send(validPayload);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already registered/i);
        expect(db.user.create).not.toHaveBeenCalled();
    });

    test('400 — duplicate NIC number is rejected', async () => {
        db.user.findUnique
            .mockResolvedValueOnce(null)              // email is free
            .mockResolvedValueOnce({ id: 'nic-dup' }); // NIC already exists

        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', adminToken())
            .send(validPayload);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/nic number/i);
    });

    test('400 — missing required field (name) returns validation error', async () => {
        const { name: _n, ...noName } = validPayload as any;

        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', adminToken())
            .send(noName);

        expect(res.status).toBe(400);
        expect(db.user.create).not.toHaveBeenCalled();
    });

    test('400 — password shorter than 6 characters is rejected', async () => {
        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', adminToken())
            .send({ ...validPayload, password: '123' }); // too short

        expect(res.status).toBe(400);
    });

    test('403 — MANAGER cannot create employees (admin-only action)', async () => {
        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', managerToken())
            .send(validPayload);

        expect(res.status).toBe(403);
    });

    test('403 — EMPLOYEE cannot create employees', async () => {
        const res = await request(app)
            .post('/api/employees')
            .set('Authorization', employeeToken())
            .send(validPayload);

        expect(res.status).toBe(403);
    });
});

// ── PATCH /api/employees/:id/status — activate / deactivate ──────────────────

describe('PATCH /api/employees/:id/status — toggle account status', () => {
    test('200 — admin deactivates an employee account', async () => {
        db.user.findUnique.mockResolvedValue({
            id: 'emp-1', role: 'EMPLOYEE', isActive: true,
        });
        db.user.update.mockResolvedValue({
            id: 'emp-1', name: 'Alice', isActive: false,
        });

        const res = await request(app)
            .patch('/api/employees/emp-1/status')
            .set('Authorization', adminToken())
            .send({ isActive: false });

        expect(res.status).toBe(200);
        expect(res.body.isActive).toBe(false);
    });

    test('200 — admin reactivates a deactivated employee', async () => {
        db.user.findUnique.mockResolvedValue({
            id: 'emp-1', role: 'EMPLOYEE', isActive: false,
        });
        db.user.update.mockResolvedValue({
            id: 'emp-1', name: 'Alice', isActive: true,
        });

        const res = await request(app)
            .patch('/api/employees/emp-1/status')
            .set('Authorization', adminToken())
            .send({ isActive: true });

        expect(res.status).toBe(200);
        expect(res.body.isActive).toBe(true);
    });

    test('404 — returns 404 when employee ID does not exist', async () => {
        db.user.findUnique.mockResolvedValue(null); // not found

        const res = await request(app)
            .patch('/api/employees/nonexistent/status')
            .set('Authorization', adminToken())
            .send({ isActive: false });

        expect(res.status).toBe(404);
    });

    test('400 — non-boolean isActive value is rejected by schema', async () => {
        const res = await request(app)
            .patch('/api/employees/emp-1/status')
            .set('Authorization', adminToken())
            .send({ isActive: 'yes' }); // string instead of boolean

        expect(res.status).toBe(400);
        expect(db.user.update).not.toHaveBeenCalled();
    });

    test('403 — MANAGER cannot change employee status', async () => {
        const res = await request(app)
            .patch('/api/employees/emp-1/status')
            .set('Authorization', managerToken())
            .send({ isActive: false });

        expect(res.status).toBe(403);
    });
});
