/**
 * Integration tests — Inventory routes (/api/inventory)
 * All endpoints are MANAGER-only; tests verify auth enforcement and CRUD logic.
 */

jest.mock('../../lib/prisma', () => ({
    __esModule: true,
    default: {
        sparePart:   { findMany: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() },
        stockLedger: { create: jest.fn(), findMany: jest.fn() },
    },
}));

import request from 'supertest';
import app     from '../helpers/testApp';
import prisma  from '../../lib/prisma';
import { managerToken, adminToken, employeeToken } from '../helpers/tokenHelper';

const db = prisma as unknown as {
    sparePart:   { findMany: jest.Mock; create: jest.Mock; findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    stockLedger: { create: jest.Mock; findMany: jest.Mock };
};

beforeEach(() => jest.clearAllMocks());

const samplePart = {
    id: 'part-1', name: 'Oil Filter', serialNumber: 'OF-001',
    boughtPrice: 800, sellingPrice: 1000, quantity: 20,
    lowStockThreshold: 5, supplierName: 'AutoParts Ltd',
};

// ── Role enforcement (all routes require MANAGER) ─────────────────────────────

describe('Role enforcement — MANAGER only', () => {
    const routes = [
        { method: 'get',   path: '/api/inventory' },
        { method: 'post',  path: '/api/inventory' },
        { method: 'get',   path: '/api/inventory/search?q=oil' },
    ];

    routes.forEach(({ method, path }) => {
        test(`403 — ADMIN cannot access ${method.toUpperCase()} ${path}`, async () => {
            const res = await (request(app) as any)[method](path)
                .set('Authorization', adminToken())
                .send({});
            expect(res.status).toBe(403);
        });

        test(`403 — EMPLOYEE cannot access ${method.toUpperCase()} ${path}`, async () => {
            const res = await (request(app) as any)[method](path)
                .set('Authorization', employeeToken())
                .send({});
            expect(res.status).toBe(403);
        });

        test(`401 — unauthenticated request rejected for ${method.toUpperCase()} ${path}`, async () => {
            const res = await (request(app) as any)[method](path).send({});
            expect(res.status).toBe(401);
        });
    });
});

// ── GET /api/inventory ────────────────────────────────────────────────────────

describe('GET /api/inventory — list all parts', () => {
    test('200 — returns parts array and calculated totalValue', async () => {
        const parts = [
            { ...samplePart, boughtPrice: 800,  quantity: 20 }, // 16000
            { ...samplePart, id: 'part-2', boughtPrice: 1200, quantity: 5 },  // 6000
        ];
        db.sparePart.findMany.mockResolvedValue(parts);

        const res = await request(app)
            .get('/api/inventory')
            .set('Authorization', managerToken());

        expect(res.status).toBe(200);
        expect(res.body.parts).toHaveLength(2);
        expect(res.body.totalValue).toBe(22000); // 16000 + 6000
    });

    test('200 — returns empty array and 0 totalValue when no parts', async () => {
        db.sparePart.findMany.mockResolvedValue([]);

        const res = await request(app)
            .get('/api/inventory')
            .set('Authorization', managerToken());

        expect(res.status).toBe(200);
        expect(res.body.parts).toHaveLength(0);
        expect(res.body.totalValue).toBe(0);
    });
});

// ── POST /api/inventory ───────────────────────────────────────────────────────

describe('POST /api/inventory — create spare part', () => {
    const payload = {
        name: 'Oil Filter', serialNumber: 'OF-999',
        boughtPrice: 800, sellingPrice: 1000, quantity: 50,
        lowStockThreshold: 5,
    };

    test('201 — manager creates spare part successfully', async () => {
        db.sparePart.create.mockResolvedValue({ id: 'part-new', ...payload });

        const res = await request(app)
            .post('/api/inventory')
            .set('Authorization', managerToken())
            .send(payload);

        expect(res.status).toBe(201);
        expect(res.body.name).toBe('Oil Filter');
        expect(res.body.quantity).toBe(50);
    });

    test('409 — duplicate serialNumber returns conflict', async () => {
        const prismaUniqueError = { code: 'P2002' };
        db.sparePart.create.mockRejectedValue(prismaUniqueError);

        const res = await request(app)
            .post('/api/inventory')
            .set('Authorization', managerToken())
            .send(payload);

        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/serial number/i);
    });

    test('400 — missing required fields (name)', async () => {
        const { name: _n, ...noName } = payload as any;
        const res = await request(app)
            .post('/api/inventory')
            .set('Authorization', managerToken())
            .send(noName);

        expect(res.status).toBe(400);
    });

    test('400 — negative boughtPrice rejected by schema', async () => {
        const res = await request(app)
            .post('/api/inventory')
            .set('Authorization', managerToken())
            .send({ ...payload, boughtPrice: -100 });

        expect(res.status).toBe(400);
    });
});

// ── PUT /api/inventory/:id ────────────────────────────────────────────────────

describe('PUT /api/inventory/:id — update part / stock adjustment', () => {
    test('200 — price-only update does NOT create stock ledger entry', async () => {
        db.sparePart.findUnique.mockResolvedValue({ ...samplePart, quantity: 20 });
        db.sparePart.update.mockResolvedValue({ ...samplePart, sellingPrice: 1200 });

        const res = await request(app)
            .put('/api/inventory/part-1')
            .set('Authorization', managerToken())
            .send({ sellingPrice: 1200 }); // no quantity change

        expect(res.status).toBe(200);
        expect(db.stockLedger.create).not.toHaveBeenCalled();
    });

    test('200 — quantity change creates a StockLedger entry', async () => {
        db.sparePart.findUnique.mockResolvedValue({ ...samplePart, quantity: 20 });
        db.stockLedger.create.mockResolvedValue({ id: 'sl-1', change: -5 });
        db.sparePart.update.mockResolvedValue({ ...samplePart, quantity: 15 });

        const res = await request(app)
            .put('/api/inventory/part-1')
            .set('Authorization', managerToken())
            .send({ quantity: 15, adjustmentReason: 'Damaged parts removed' });

        expect(res.status).toBe(200);
        expect(db.stockLedger.create).toHaveBeenCalledTimes(1);
        expect(db.stockLedger.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    change: -5, // 15 - 20 = -5
                    reason: 'Damaged parts removed',
                }),
            }),
        );
    });

    test('200 — stock increase creates positive ledger entry', async () => {
        db.sparePart.findUnique.mockResolvedValue({ ...samplePart, quantity: 10 });
        db.stockLedger.create.mockResolvedValue({ id: 'sl-2', change: 10 });
        db.sparePart.update.mockResolvedValue({ ...samplePart, quantity: 20 });

        await request(app)
            .put('/api/inventory/part-1')
            .set('Authorization', managerToken())
            .send({ quantity: 20, adjustmentReason: 'Restock received' });

        expect(db.stockLedger.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ change: 10 }),
            }),
        );
    });

    test('404 — part not found', async () => {
        db.sparePart.findUnique.mockResolvedValue(null);

        const res = await request(app)
            .put('/api/inventory/missing-id')
            .set('Authorization', managerToken())
            .send({ sellingPrice: 1200 });

        expect(res.status).toBe(404);
    });
});

// ── DELETE /api/inventory/:id ─────────────────────────────────────────────────

describe('DELETE /api/inventory/:id', () => {
    test('200 — manager deletes spare part', async () => {
        db.sparePart.delete.mockResolvedValue(samplePart);

        const res = await request(app)
            .delete('/api/inventory/part-1')
            .set('Authorization', managerToken());

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('success', true);
    });
});

// ── GET /api/inventory/:id/ledger ─────────────────────────────────────────────

describe('GET /api/inventory/:id/ledger — stock history', () => {
    test('200 — returns ledger entries for a part', async () => {
        const entries = [
            { id: 'sl-1', change: -3, reason: 'Quotation #42', createdAt: new Date() },
            { id: 'sl-2', change:  10, reason: 'Restock',       createdAt: new Date() },
        ];
        db.stockLedger.findMany.mockResolvedValue(entries);

        const res = await request(app)
            .get('/api/inventory/part-1/ledger')
            .set('Authorization', managerToken());

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(2);
        expect(res.body[0].change).toBe(-3);
    });
});
