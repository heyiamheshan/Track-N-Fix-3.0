/**
 * Integration tests — Job routes (/api/jobs)
 */

jest.mock('../../lib/prisma', () => ({
    __esModule: true,
    default: {
        vehicle: { findUnique: jest.fn(), create: jest.fn() },
        job:     { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    },
}));

import request from 'supertest';
import app     from '../helpers/testApp';
import prisma  from '../../lib/prisma';
import { employeeToken, adminToken, managerToken } from '../helpers/tokenHelper';

const db = prisma as unknown as {
    vehicle: { findUnique: jest.Mock; create: jest.Mock };
    job:     { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
};

beforeEach(() => jest.clearAllMocks());

// ── POST /api/jobs ────────────────────────────────────────────────────────────

describe('POST /api/jobs — create job', () => {
    const endpoint = '/api/jobs';
    const payload  = { vehicleNumber: 'WP-ABC-1234', jobType: 'SERVICE', notes: 'Oil change' };

    test('201 — employee creates job, auto-creates vehicle if new', async () => {
        db.vehicle.findUnique.mockResolvedValue(null); // vehicle not found → will be created
        db.vehicle.create.mockResolvedValue({ id: 'v-1', vehicleNumber: 'WP-ABC-1234' });
        db.job.create.mockResolvedValue({
            id: 'j-1', jobNumber: 1, vehicleId: 'v-1', employeeId: 'test-user-id',
            jobType: 'SERVICE', status: 'DRAFT', notes: 'Oil change',
            vehicle: { vehicleNumber: 'WP-ABC-1234' },
            employee: { id: 'test-user-id', name: 'Test Employee' },
            images: [],
        });

        const res = await request(app)
            .post(endpoint)
            .set('Authorization', employeeToken())
            .send(payload);

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('DRAFT');
        expect(res.body.jobType).toBe('SERVICE');
        expect(db.vehicle.create).toHaveBeenCalledTimes(1);
    });

    test('201 — reuses existing vehicle (no duplicate creation)', async () => {
        db.vehicle.findUnique.mockResolvedValue({ id: 'v-existing', vehicleNumber: 'WP-ABC-1234' });
        db.job.create.mockResolvedValue({
            id: 'j-2', jobNumber: 2, vehicleId: 'v-existing', employeeId: 'test-user-id',
            jobType: 'SERVICE', status: 'DRAFT',
            vehicle: { vehicleNumber: 'WP-ABC-1234' },
            employee: { id: 'test-user-id', name: 'Test Employee' },
            images: [],
        });

        const res = await request(app)
            .post(endpoint)
            .set('Authorization', employeeToken())
            .send(payload);

        expect(res.status).toBe(201);
        expect(db.vehicle.create).not.toHaveBeenCalled(); // existing vehicle reused
    });

    test('401 — no auth token', async () => {
        const res = await request(app).post(endpoint).send(payload);
        expect(res.status).toBe(401);
    });

    test('403 — ADMIN cannot create a job', async () => {
        const res = await request(app)
            .post(endpoint)
            .set('Authorization', adminToken())
            .send(payload);
        expect(res.status).toBe(403);
    });

    test('403 — MANAGER cannot create a job', async () => {
        const res = await request(app)
            .post(endpoint)
            .set('Authorization', managerToken())
            .send(payload);
        expect(res.status).toBe(403);
    });

    test('400 — missing required vehicleNumber', async () => {
        const res = await request(app)
            .post(endpoint)
            .set('Authorization', employeeToken())
            .send({ jobType: 'SERVICE' });
        expect(res.status).toBe(400);
    });

    test('400 — invalid jobType', async () => {
        const res = await request(app)
            .post(endpoint)
            .set('Authorization', employeeToken())
            .send({ vehicleNumber: 'WP-ABC-1234', jobType: 'INVALID_TYPE' });
        expect(res.status).toBe(400);
    });
});

// ── PUT /api/jobs/:id/submit ──────────────────────────────────────────────────

describe('PUT /api/jobs/:id/submit — DRAFT → SUBMITTED', () => {
    test('200 — employee submits own DRAFT job', async () => {
        db.job.findUnique.mockResolvedValue({
            id: 'j-1', employeeId: 'test-user-id', status: 'DRAFT',
        });
        db.job.update.mockResolvedValue({
            id: 'j-1', status: 'SUBMITTED',
            vehicle: {}, employee: { id: 'test-user-id', name: 'Test' }, images: [],
        });

        const res = await request(app)
            .put('/api/jobs/j-1/submit')
            .set('Authorization', employeeToken());

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('SUBMITTED');
        expect(db.job.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: 'SUBMITTED' } }),
        );
    });

    test('403 — employee cannot submit another employee\'s job', async () => {
        db.job.findUnique.mockResolvedValue({
            id: 'j-1', employeeId: 'OTHER-employee-id', status: 'DRAFT',
        });

        const res = await request(app)
            .put('/api/jobs/j-1/submit')
            .set('Authorization', employeeToken()); // token has id='test-user-id'

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/not your job/i);
    });

    test('400 — cannot submit an already-submitted job', async () => {
        db.job.findUnique.mockResolvedValue({
            id: 'j-1', employeeId: 'test-user-id', status: 'SUBMITTED',
        });

        const res = await request(app)
            .put('/api/jobs/j-1/submit')
            .set('Authorization', employeeToken());

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already submitted/i);
    });

    test('404 — job not found', async () => {
        db.job.findUnique.mockResolvedValue(null);

        const res = await request(app)
            .put('/api/jobs/nonexistent/submit')
            .set('Authorization', employeeToken());

        expect(res.status).toBe(404);
    });
});

// ── PUT /api/jobs/:id/review — SUBMITTED → REVIEWED ──────────────────────────

describe('PUT /api/jobs/:id/review — admin review', () => {
    test('200 — admin marks SUBMITTED job as REVIEWED', async () => {
        db.job.update.mockResolvedValue({
            id: 'j-1', status: 'REVIEWED',
            vehicle: {}, images: [], employee: { id: 'emp-1', name: 'Emp' },
        });

        const res = await request(app)
            .put('/api/jobs/j-1/review')
            .set('Authorization', adminToken());

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('REVIEWED');
    });

    test('403 — EMPLOYEE cannot review a job', async () => {
        const res = await request(app)
            .put('/api/jobs/j-1/review')
            .set('Authorization', employeeToken());
        expect(res.status).toBe(403);
    });

    test('403 — MANAGER cannot review a job', async () => {
        const res = await request(app)
            .put('/api/jobs/j-1/review')
            .set('Authorization', managerToken());
        expect(res.status).toBe(403);
    });
});

// ── GET /api/jobs — role-based filtering ─────────────────────────────────────

describe('GET /api/jobs — role-based list filtering', () => {
    test('employee sees only their own jobs', async () => {
        db.job.findMany.mockResolvedValue([
            { id: 'j-1', employeeId: 'test-user-id', status: 'DRAFT' },
        ]);

        const res = await request(app)
            .get('/api/jobs')
            .set('Authorization', employeeToken());

        expect(res.status).toBe(200);
        // Verify where clause filters by employeeId
        expect(db.job.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { employeeId: 'test-user-id' },
            }),
        );
    });

    test('admin sees SUBMITTED/REVIEWED/QUOTED jobs (not DRAFT)', async () => {
        db.job.findMany.mockResolvedValue([]);

        await request(app)
            .get('/api/jobs')
            .set('Authorization', adminToken());

        expect(db.job.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { status: { in: ['SUBMITTED', 'REVIEWED', 'QUOTED'] } },
            }),
        );
    });

    test('401 without token', async () => {
        const res = await request(app).get('/api/jobs');
        expect(res.status).toBe(401);
    });
});
