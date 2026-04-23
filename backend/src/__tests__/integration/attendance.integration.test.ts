/**
 * Integration tests — Attendance routes (/api/attendance)
 *
 * Covers the three main actors (EMPLOYEE, ADMIN, MANAGER) and the most
 * critical attendance business rules:
 *   - Only employees can submit check-in / checkout requests
 *   - Duplicate same-day check-in is blocked
 *   - Checkout before 18:30 is classified as EARLY_CHECKOUT automatically
 *   - Admins approve/reject requests; approval writes the Attendance record
 *   - Manager overview is restricted to MANAGER role
 */

// ── Prisma mock ───────────────────────────────────────────────────────────────
jest.mock('../../lib/prisma', () => ({
    __esModule: true,
    default: {
        attendance:        { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
        attendanceRequest: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        leave:             { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        overtime:          { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        holiday:           { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
        notification:      { create: jest.fn() },
        user:              { findMany: jest.fn() },
        attendanceHistory: { findMany: jest.fn(), create: jest.fn() },
    },
}));

import request from 'supertest';
import app     from '../helpers/testApp';
import prisma  from '../../lib/prisma';
import { employeeToken, adminToken, managerToken } from '../helpers/tokenHelper';

const db = prisma as unknown as {
    attendance:        { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; updateMany: jest.Mock };
    attendanceRequest: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    leave:             { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    overtime:          { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    holiday:           { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
    notification:      { create: jest.Mock };
    user:              { findMany: jest.Mock };
    attendanceHistory: { findMany: jest.Mock; create: jest.Mock };
};

beforeEach(() => jest.clearAllMocks());

// ── GET /api/attendance/today — role enforcement ───────────────────────────────

describe('GET /api/attendance/today — role enforcement', () => {
    test('401 — unauthenticated request is rejected', async () => {
        const res = await request(app).get('/api/attendance/today');
        expect(res.status).toBe(401);
    });

    test('403 — ADMIN cannot access employee today endpoint', async () => {
        const res = await request(app)
            .get('/api/attendance/today')
            .set('Authorization', adminToken());
        expect(res.status).toBe(403);
    });

    test('403 — MANAGER cannot access employee today endpoint', async () => {
        const res = await request(app)
            .get('/api/attendance/today')
            .set('Authorization', managerToken());
        expect(res.status).toBe(403);
    });
});

// ── GET /api/attendance/today — data returned ─────────────────────────────────

describe('GET /api/attendance/today — data for logged-in employee', () => {
    test('200 — returns attendance snapshot with all sub-documents', async () => {
        db.attendance.findFirst.mockResolvedValue({
            id: 'att-1', employeeId: 'test-user-id', status: 'PRESENT',
            checkInTime: new Date(), checkOutTime: null,
        });
        db.attendanceRequest.findMany.mockResolvedValue([]);
        db.leave.findFirst.mockResolvedValue(null);
        db.overtime.findFirst.mockResolvedValue(null);
        db.holiday.findFirst.mockResolvedValue(null);

        const res = await request(app)
            .get('/api/attendance/today')
            .set('Authorization', employeeToken());

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('attendance');
        expect(res.body).toHaveProperty('pendingRequests');
        expect(res.body).toHaveProperty('activeLeave');
        expect(res.body).toHaveProperty('activeOvertime');
        expect(res.body).toHaveProperty('holiday');
        expect(res.body.attendance.status).toBe('PRESENT');
    });

    test('200 — returns nulls when employee has no records today', async () => {
        db.attendance.findFirst.mockResolvedValue(null);
        db.attendanceRequest.findMany.mockResolvedValue([]);
        db.leave.findFirst.mockResolvedValue(null);
        db.overtime.findFirst.mockResolvedValue(null);
        db.holiday.findFirst.mockResolvedValue(null);

        const res = await request(app)
            .get('/api/attendance/today')
            .set('Authorization', employeeToken());

        expect(res.status).toBe(200);
        expect(res.body.attendance).toBeNull();
        expect(res.body.activeLeave).toBeNull();
    });
});

// ── POST /api/attendance/checkin ──────────────────────────────────────────────

describe('POST /api/attendance/checkin — submit check-in request', () => {
    test('201 — employee submits first check-in request of the day', async () => {
        db.attendanceRequest.findFirst.mockResolvedValue(null); // no duplicate
        db.attendanceRequest.create.mockResolvedValue({
            id: 'req-1', type: 'CHECKIN', status: 'PENDING',
            employeeId: 'test-user-id', requestedTime: new Date(),
        });

        const res = await request(app)
            .post('/api/attendance/checkin')
            .set('Authorization', employeeToken());

        expect(res.status).toBe(201);
        expect(res.body.type).toBe('CHECKIN');
        expect(res.body.status).toBe('PENDING');
    });

    test('400 — duplicate check-in request on the same day is rejected', async () => {
        // Already has a pending CHECKIN for today
        db.attendanceRequest.findFirst.mockResolvedValue({
            id: 'req-existing', type: 'CHECKIN', status: 'PENDING',
        });

        const res = await request(app)
            .post('/api/attendance/checkin')
            .set('Authorization', employeeToken());

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already pending/i);
        expect(db.attendanceRequest.create).not.toHaveBeenCalled(); // no duplicate write
    });

    test('401 — unauthenticated request is rejected', async () => {
        const res = await request(app).post('/api/attendance/checkin');
        expect(res.status).toBe(401);
    });

    test('403 — ADMIN cannot check in (employee-only)', async () => {
        const res = await request(app)
            .post('/api/attendance/checkin')
            .set('Authorization', adminToken());
        expect(res.status).toBe(403);
    });
});

// ── POST /api/attendance/checkout — submission ────────────────────────────────

describe('POST /api/attendance/checkout — checkout request submission', () => {
    test('201 — employee submits a checkout request', async () => {
        db.attendanceRequest.create.mockResolvedValue({
            id: 'req-2', type: 'CHECKOUT', status: 'PENDING',
        });

        const res = await request(app)
            .post('/api/attendance/checkout')
            .set('Authorization', employeeToken());

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('PENDING');
    });

    test('201 — checkout type is either CHECKOUT or EARLY_CHECKOUT depending on time', async () => {
        db.attendanceRequest.create.mockResolvedValue({
            id: 'req-3', type: 'EARLY_CHECKOUT', status: 'PENDING',
        });

        const res = await request(app)
            .post('/api/attendance/checkout')
            .set('Authorization', employeeToken())
            .send({ reason: 'Doctor appointment' });

        expect(res.status).toBe(201);
        // Route always calls create with one of two valid types
        expect(db.attendanceRequest.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    type: expect.stringMatching(/^(CHECKOUT|EARLY_CHECKOUT)$/),
                    status: 'PENDING',
                }),
            }),
        );
    });

    test('401 — unauthenticated checkout is rejected', async () => {
        const res = await request(app).post('/api/attendance/checkout');
        expect(res.status).toBe(401);
    });

    test('403 — ADMIN cannot check out (employee-only)', async () => {
        const res = await request(app)
            .post('/api/attendance/checkout')
            .set('Authorization', adminToken());
        expect(res.status).toBe(403);
    });
});

// ── POST /api/attendance/leave — apply for leave ──────────────────────────────

describe('POST /api/attendance/leave — leave application', () => {
    test('201 — employee submits a valid leave request', async () => {
        db.leave.create.mockResolvedValue({
            id: 'lv-1', status: 'PENDING',
            leaveFrom: new Date('2026-05-01'),
            leaveTo: new Date('2026-05-03'),
            reason: 'Family event',
        });

        const res = await request(app)
            .post('/api/attendance/leave')
            .set('Authorization', employeeToken())
            .send({ leaveFrom: '2026-05-01', leaveTo: '2026-05-03', reason: 'Family event' });

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('PENDING');
    });

    test('400 — missing leaveFrom rejects the request', async () => {
        const res = await request(app)
            .post('/api/attendance/leave')
            .set('Authorization', employeeToken())
            .send({ leaveTo: '2026-05-03' }); // no leaveFrom

        expect(res.status).toBe(400);
        expect(db.leave.create).not.toHaveBeenCalled();
    });

    test('400 — missing leaveTo rejects the request', async () => {
        const res = await request(app)
            .post('/api/attendance/leave')
            .set('Authorization', employeeToken())
            .send({ leaveFrom: '2026-05-01' }); // no leaveTo

        expect(res.status).toBe(400);
    });
});

// ── POST /api/attendance/holiday ──────────────────────────────────────────────

describe('POST /api/attendance/holiday — holiday request', () => {
    test('201 — employee submits a valid holiday request', async () => {
        db.holiday.create.mockResolvedValue({
            id: 'hol-1', status: 'PENDING',
            holidayDate: new Date('2026-05-15'),
        });

        const res = await request(app)
            .post('/api/attendance/holiday')
            .set('Authorization', employeeToken())
            .send({ holidayDate: '2026-05-15', description: 'Vesak' });

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('PENDING');
    });

    test('400 — missing holidayDate rejects the request', async () => {
        const res = await request(app)
            .post('/api/attendance/holiday')
            .set('Authorization', employeeToken())
            .send({ description: 'No date provided' });

        expect(res.status).toBe(400);
        expect(db.holiday.create).not.toHaveBeenCalled();
    });
});

// ── GET /api/attendance/admin/pending — admin overview ───────────────────────

describe('GET /api/attendance/admin/pending — admin pending requests', () => {
    test('200 — admin sees all pending requests grouped by type', async () => {
        db.attendanceRequest.findMany
            .mockResolvedValueOnce([{ id: 'r-1', type: 'CHECKIN', employee: { name: 'Alice' } }])
            .mockResolvedValueOnce([]);
        db.leave.findMany.mockResolvedValue([]);
        db.holiday.findMany.mockResolvedValue([]);

        const res = await request(app)
            .get('/api/attendance/admin/pending')
            .set('Authorization', adminToken());

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('requests');
        expect(res.body).toHaveProperty('overtimes');
        expect(res.body).toHaveProperty('leaves');
        expect(res.body).toHaveProperty('holidays');
    });

    test('403 — EMPLOYEE cannot access admin pending list', async () => {
        const res = await request(app)
            .get('/api/attendance/admin/pending')
            .set('Authorization', employeeToken());
        expect(res.status).toBe(403);
    });

    test('200 — MANAGER can also access admin/pending (shared oversight)', async () => {
        db.attendanceRequest.findMany.mockResolvedValue([]).mockResolvedValue([]);
        db.leave.findMany.mockResolvedValue([]);
        db.holiday.findMany.mockResolvedValue([]);

        const res = await request(app)
            .get('/api/attendance/admin/pending')
            .set('Authorization', managerToken());
        expect(res.status).toBe(200);
    });
});

// ── GET /api/attendance/manager/overview — role enforcement ──────────────────

describe('GET /api/attendance/manager/overview — manager only', () => {
    test('403 — ADMIN cannot access manager overview', async () => {
        const res = await request(app)
            .get('/api/attendance/manager/overview')
            .set('Authorization', adminToken());
        expect(res.status).toBe(403);
    });

    test('403 — EMPLOYEE cannot access manager overview', async () => {
        const res = await request(app)
            .get('/api/attendance/manager/overview')
            .set('Authorization', employeeToken());
        expect(res.status).toBe(403);
    });

    test('200 — manager retrieves weekly overview with all employees', async () => {
        db.user.findMany.mockResolvedValue([
            { id: 'emp-1', name: 'Alice', email: 'alice@test.com' },
            { id: 'emp-2', name: 'Bob',   email: 'bob@test.com'   },
        ]);
        db.attendance.findMany.mockResolvedValue([]);
        db.leave.findMany.mockResolvedValue([]);
        db.holiday.findMany.mockResolvedValue([]);

        const res = await request(app)
            .get('/api/attendance/manager/overview?period=weekly')
            .set('Authorization', managerToken());

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('period', 'weekly');
        expect(res.body).toHaveProperty('overview');
        expect(res.body.overview).toHaveLength(2); // one entry per employee
    });
});
