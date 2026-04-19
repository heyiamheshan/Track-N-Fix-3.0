/**
 * Integration tests — Quotation routes (/api/quotations)
 * Covers the core job-to-delivery workflow.
 */

jest.mock('../../lib/prisma', () => ({
    __esModule: true,
    default: {
        vehicle:       { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
        job:           { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
        quotation:     { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
        quotationItem: { createMany: jest.fn(), deleteMany: jest.fn() },
        sparePart:     { findUnique: jest.fn() },
        notification:  { create: jest.fn() },
        $transaction:  jest.fn(),
    },
}));

import request from 'supertest';
import app     from '../helpers/testApp';
import prisma  from '../../lib/prisma';
import { adminToken, managerToken, employeeToken } from '../helpers/tokenHelper';

const db = prisma as unknown as {
    vehicle:       { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
    job:           { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    quotation:     { create: jest.Mock; findUnique: jest.Mock; findMany: jest.Mock; update: jest.Mock };
    quotationItem: { createMany: jest.Mock; deleteMany: jest.Mock };
    sparePart:     { findUnique: jest.Mock };
    notification:  { create: jest.Mock };
    $transaction:  jest.Mock;
};

beforeEach(() => jest.clearAllMocks());

// ── POST /api/quotations — create quotation ───────────────────────────────────

describe('POST /api/quotations — create', () => {
    const payload = {
        vehicleNumber: 'WP-XYZ-5678',
        ownerName:     'Kamal Perera',
        telephone:     '0712345678',
        vehicleType:   'Sedan',
    };
    const mockVehicle    = { id: 'v-1', vehicleNumber: 'WP-XYZ-5678' };
    const mockJob        = { id: 'j-1', status: 'QUOTED' };
    const mockQuotation  = { id: 'q-1', status: 'DRAFT', items: [], job: { images: [], employee: { id: 'e-1', name: 'Emp' } }, vehicle: mockVehicle };

    beforeEach(() => {
        db.vehicle.findUnique.mockResolvedValue(mockVehicle);
        db.vehicle.update.mockResolvedValue(mockVehicle);
        db.job.create.mockResolvedValue(mockJob);
        db.quotation.create.mockResolvedValue({ id: 'q-1', status: 'DRAFT' });
        db.quotation.findUnique.mockResolvedValue(mockQuotation);
        db.quotationItem.createMany.mockResolvedValue({ count: 0 });
    });

    test('201 — admin creates quotation in DRAFT status', async () => {
        const res = await request(app)
            .post('/api/quotations')
            .set('Authorization', adminToken())
            .send(payload);

        expect(res.status).toBe(201);
        expect(res.body.status).toBe('DRAFT');
    });

    test('201 — manager creates quotation (skips DRAFT → SENT_TO_MANAGER directly)', async () => {
        db.quotation.findUnique.mockResolvedValue({ ...mockQuotation, status: 'SENT_TO_MANAGER' });
        db.quotation.create.mockResolvedValue({ id: 'q-2', status: 'SENT_TO_MANAGER' });

        const res = await request(app)
            .post('/api/quotations')
            .set('Authorization', managerToken())
            .send(payload);

        expect(res.status).toBe(201);
    });

    test('403 — EMPLOYEE cannot create a quotation', async () => {
        const res = await request(app)
            .post('/api/quotations')
            .set('Authorization', employeeToken())
            .send(payload);

        expect(res.status).toBe(403);
    });

    test('400 — missing telephone (required field)', async () => {
        const { telephone: _t, ...noTel } = payload as any;
        const res = await request(app)
            .post('/api/quotations')
            .set('Authorization', adminToken())
            .send(noTel);

        expect(res.status).toBe(400);
    });
});

// ── PUT /api/quotations/:id/send — DRAFT → SENT_TO_MANAGER ───────────────────

describe('PUT /api/quotations/:id/send — admin sends to manager', () => {
    test('200 — transitions to SENT_TO_MANAGER when telephone is present', async () => {
        db.quotation.findUnique.mockResolvedValue({
            id: 'q-1', status: 'DRAFT', telephone: '0712345678',
        });
        db.quotation.update.mockResolvedValue({
            id: 'q-1', status: 'SENT_TO_MANAGER', job: {}, vehicle: {}, items: [],
        });

        const res = await request(app)
            .put('/api/quotations/q-1/send')
            .set('Authorization', adminToken());

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('SENT_TO_MANAGER');
    });

    test('400 — blocked when telephone is missing', async () => {
        db.quotation.findUnique.mockResolvedValue({
            id: 'q-1', status: 'DRAFT', telephone: '',
        });

        const res = await request(app)
            .put('/api/quotations/q-1/send')
            .set('Authorization', adminToken());

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/telephone/i);
    });

    test('404 — quotation not found', async () => {
        db.quotation.findUnique.mockResolvedValue(null);

        const res = await request(app)
            .put('/api/quotations/nonexistent/send')
            .set('Authorization', adminToken());

        expect(res.status).toBe(404);
    });

    test('403 — MANAGER cannot send (admin-only action)', async () => {
        const res = await request(app)
            .put('/api/quotations/q-1/send')
            .set('Authorization', managerToken());

        expect(res.status).toBe(403);
    });
});

// ── PUT /api/quotations/:id/finalize — manager finalizes ─────────────────────

describe('PUT /api/quotations/:id/finalize — atomic finalisation', () => {
    const mockPart = {
        id: 'part-1', name: 'Oil Filter', quantity: 10, boughtPrice: 500,
    };
    const finalizePayload = {
        totalAmount: 7500,
        items: [{
            description: 'Oil change service',
            price: 2000, laborCost: 1000, quantity: 1,
            sparePartId: 'part-1',
        }],
    };

    test('200 — successfully finalizes with inventory deduction via $transaction', async () => {
        db.sparePart.findUnique.mockResolvedValue(mockPart); // sufficient stock
        db.quotation.findUnique.mockResolvedValueOnce({     // pre-check
            id: 'q-1', jobId: 'j-1', vehicleNumber: 'WP-XYZ-5678',
            job: { jobNumber: 42 },
        });
        db.$transaction.mockImplementation(async (fn: (tx: any) => Promise<void>) => {
            // Execute the callback with a partial tx mock so the route doesn't crash
            await fn({
                quotationItem: { deleteMany: jest.fn(), createMany: jest.fn() },
                quotation:     { update: jest.fn() },
                job:           { update: jest.fn() },
                sparePart:     { update: jest.fn() },
                stockLedger:   { create: jest.fn() },
                notification:  { create: jest.fn() },
            });
        });
        db.quotation.findUnique.mockResolvedValueOnce({ // post-transaction fetch
            id: 'q-1', status: 'FINALIZED', totalAmount: 7500, items: [], job: { images: [] }, vehicle: {},
        });

        const res = await request(app)
            .put('/api/quotations/q-1/finalize')
            .set('Authorization', managerToken())
            .send(finalizePayload);

        expect(res.status).toBe(200);
        expect(db.$transaction).toHaveBeenCalledTimes(1);
    });

    test('409 — insufficient stock blocks finalization', async () => {
        db.sparePart.findUnique.mockResolvedValue({
            id: 'part-1', name: 'Oil Filter', quantity: 0, // stock depleted
        });
        db.quotation.findUnique.mockResolvedValue({
            id: 'q-1', jobId: 'j-1', vehicleNumber: 'WP-XYZ-5678',
            job: { jobNumber: 42 },
        });

        const res = await request(app)
            .put('/api/quotations/q-1/finalize')
            .set('Authorization', managerToken())
            .send(finalizePayload);

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/insufficient stock/i);
        expect(db.$transaction).not.toHaveBeenCalled(); // rolled back before atomic write
    });

    test('400 — spare part ID not found', async () => {
        db.sparePart.findUnique.mockResolvedValue(null); // part missing

        const res = await request(app)
            .put('/api/quotations/q-1/finalize')
            .set('Authorization', managerToken())
            .send(finalizePayload);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/not found/i);
    });

    test('403 — ADMIN cannot finalize', async () => {
        const res = await request(app)
            .put('/api/quotations/q-1/finalize')
            .set('Authorization', adminToken())
            .send(finalizePayload);

        expect(res.status).toBe(403);
    });
});

// ── PATCH /api/quotations/:id/notify — customer notification ─────────────────

describe('PATCH /api/quotations/:id/notify — mark customer notified', () => {
    test('200 — sets CUSTOMER_NOTIFIED, marks job COMPLETED, notifies manager', async () => {
        db.quotation.findUnique.mockResolvedValue({
            id: 'q-1', status: 'FINALIZED', jobId: 'j-1', vehicleNumber: 'WP-ABC-1234',
            job: { id: 'j-1' },
        });
        db.quotation.update.mockResolvedValue({
            id: 'q-1', status: 'CUSTOMER_NOTIFIED', notificationSent: true,
            job: { images: [], employee: { id: 'e-1', name: 'Emp' } }, vehicle: {}, items: [],
        });
        db.job.update.mockResolvedValue({ id: 'j-1', status: 'COMPLETED' });
        db.notification.create.mockResolvedValue({ id: 'n-1' });

        const res = await request(app)
            .patch('/api/quotations/q-1/notify')
            .set('Authorization', adminToken());

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('CUSTOMER_NOTIFIED');
        expect(db.job.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: 'COMPLETED' } }),
        );
        expect(db.notification.create).toHaveBeenCalledTimes(1);
    });

    test('400 — cannot notify before finalization', async () => {
        db.quotation.findUnique.mockResolvedValue({
            id: 'q-1', status: 'SENT_TO_MANAGER', jobId: 'j-1',
            job: {},
        });

        const res = await request(app)
            .patch('/api/quotations/q-1/notify')
            .set('Authorization', adminToken());

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/finalized/i);
    });

    test('403 — MANAGER cannot trigger customer notification', async () => {
        const res = await request(app)
            .patch('/api/quotations/q-1/notify')
            .set('Authorization', managerToken());

        expect(res.status).toBe(403);
    });
});
