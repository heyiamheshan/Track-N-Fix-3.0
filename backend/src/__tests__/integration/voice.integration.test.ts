/**
 * Integration tests — Voice / AI assistant routes (/api/voice)
 * Mocks axios (Groq API calls) and Prisma to keep tests fully offline.
 */

// ── Prisma mock ───────────────────────────────────────────────────────────────
jest.mock('../../lib/prisma', () => ({
    __esModule: true,
    default: {
        vehicle:   { findUnique: jest.fn() },
        sparePart: { findMany: jest.fn() },
        user:      { findFirst: jest.fn() },
        quotation: { findMany: jest.fn() },
        attendance:{ findFirst: jest.fn() },
        leave:     { findMany: jest.fn() },
        holiday:   { findMany: jest.fn() },
        stockLedger: { findMany: jest.fn() },
    },
}));

// ── Axios mock (Groq Whisper + LLaMA calls) ───────────────────────────────────
jest.mock('axios', () => ({
    post: jest.fn(),
    default: { post: jest.fn() },
}));

// ── Multer mock (avoids real filesystem writes in CI) ─────────────────────────
jest.mock('multer', () => {
    const multerMock: any = () => ({
        single: () => (_req: any, _res: any, next: any) => next(),
    });
    multerMock.diskStorage = () => ({});
    return multerMock;
});

import request from 'supertest';
import app     from '../helpers/testApp';
import prisma  from '../../lib/prisma';
import axios   from 'axios';
import { managerToken, adminToken } from '../helpers/tokenHelper';

const db = prisma as unknown as {
    vehicle:   { findUnique: jest.Mock };
    sparePart: { findMany: jest.Mock };
    user:      { findFirst: jest.Mock };
    quotation: { findMany: jest.Mock };
    attendance:{ findFirst: jest.Mock };
    leave:     { findMany: jest.Mock };
    holiday:   { findMany: jest.Mock };
    stockLedger: { findMany: jest.Mock };
};

const mockAxios = axios as jest.Mocked<typeof axios>;

// resetAllMocks (not clearAllMocks) ensures mockResolvedValueOnce queues are
// flushed between tests and don't leak into subsequent assertions.
beforeEach(() => jest.resetAllMocks());

// ── POST /api/voice/query — role enforcement ──────────────────────────────────

describe('POST /api/voice/query — role enforcement', () => {
    test('401 — unauthenticated request rejected', async () => {
        const res = await request(app)
            .post('/api/voice/query')
            .send({ text: 'Show inventory' });

        expect(res.status).toBe(401);
    });

    test('403 — ADMIN cannot use the AI assistant (manager-only)', async () => {
        const res = await request(app)
            .post('/api/voice/query')
            .set('Authorization', adminToken())
            .send({ text: 'Show inventory' });

        expect(res.status).toBe(403);
    });
});

// ── POST /api/voice/query — missing Groq API key ─────────────────────────────

describe('POST /api/voice/query — missing GROQ_API_KEY', () => {
    test('503 — returns clear error when GROQ_API_KEY is not set', async () => {
        const original = process.env.GROQ_API_KEY;
        delete process.env.GROQ_API_KEY;

        const res = await request(app)
            .post('/api/voice/query')
            .set('Authorization', managerToken())
            .send({ text: 'How many oil filters do we have?' });

        expect(res.status).toBe(503);
        expect(res.body.error).toMatch(/groq_api_key/i);

        process.env.GROQ_API_KEY = original; // restore
    });
});

// ── POST /api/voice/query — text-based queries (Groq mocked) ─────────────────

describe('POST /api/voice/query — AI text queries', () => {
    beforeEach(() => {
        process.env.GROQ_API_KEY = 'gsk_test_key';
    });

    afterEach(() => {
        delete process.env.GROQ_API_KEY;
    });

    test('inventory_query intent — returns stock data', async () => {
        // Mock LLaMA response
        mockAxios.post.mockResolvedValueOnce({
            data: {
                choices: [{
                    message: {
                        content: JSON.stringify({
                            response: 'Found 5 oil filter units.',
                            intent:   'inventory_query',
                            params:   { partName: 'oil filter', vehicleNumber: null, employeeName: null, period: null, category: null },
                        }),
                    },
                }],
            },
        });

        db.sparePart.findMany.mockResolvedValue([
            { id: 'p-1', name: 'Oil Filter', quantity: 5, lowStockThreshold: 3 },
        ]);

        const res = await request(app)
            .post('/api/voice/query')
            .set('Authorization', managerToken())
            .send({ text: 'How many oil filters do we have?' });

        expect(res.status).toBe(200);
        expect(res.body.intent).toBe('inventory_query');
        expect(res.body.transcript).toBe('How many oil filters do we have?');
        expect(res.body.data).toBeDefined();
    });

    test('vehicle_history intent — returns vehicle + jobs data', async () => {
        mockAxios.post.mockResolvedValueOnce({
            data: {
                choices: [{
                    message: {
                        content: JSON.stringify({
                            response: 'Found 3 records for WP-ABC-1234.',
                            intent:   'vehicle_history',
                            params:   { vehicleNumber: 'WP-ABC-1234', partName: null, employeeName: null, period: null, category: null },
                        }),
                    },
                }],
            },
        });

        db.vehicle.findUnique.mockResolvedValue({
            vehicleNumber: 'WP-ABC-1234', ownerName: 'Kamal Perera',
            jobs: [
                { id: 'j-1', jobType: 'SERVICE', employee: { name: 'Emp' }, images: [], quotations: [] },
                { id: 'j-2', jobType: 'REPAIR',  employee: { name: 'Emp' }, images: [], quotations: [] },
                { id: 'j-3', jobType: 'SERVICE', employee: { name: 'Emp' }, images: [], quotations: [] },
            ],
        });

        const res = await request(app)
            .post('/api/voice/query')
            .set('Authorization', managerToken())
            .send({ text: 'Show service history for WP-ABC-1234' });

        expect(res.status).toBe(200);
        expect(res.body.intent).toBe('vehicle_history');
        expect(res.body.data.jobs).toHaveLength(3);
        expect(res.body.response).toMatch(/WP-ABC-1234/);
    });

    test('vehicle_history intent — graceful response when vehicle not found', async () => {
        mockAxios.post.mockResolvedValueOnce({
            data: {
                choices: [{
                    message: {
                        content: JSON.stringify({
                            response: 'Looking up WP-ZZZ-9999.',
                            intent:   'vehicle_history',
                            params:   { vehicleNumber: 'WP-ZZZ-9999', partName: null, employeeName: null, period: null, category: null },
                        }),
                    },
                }],
            },
        });

        db.vehicle.findUnique.mockResolvedValue(null); // not in DB

        const res = await request(app)
            .post('/api/voice/query')
            .set('Authorization', managerToken())
            .send({ text: 'Show history for WP-ZZZ-9999' });

        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();
        expect(res.body.response).toMatch(/no records found/i);
    });

    test('financial_query intent — returns revenue and profit', async () => {
        mockAxios.post.mockResolvedValueOnce({
            data: {
                choices: [{
                    message: {
                        content: JSON.stringify({
                            response: "Here's this month's financials.",
                            intent:   'financial_query',
                            params:   { period: 'this_month', category: null, vehicleNumber: null, partName: null, employeeName: null },
                        }),
                    },
                }],
            },
        });

        db.quotation.findMany.mockResolvedValue([
            { id: 'q-1', totalAmount: 10000, job: { jobType: 'SERVICE' } },
            { id: 'q-2', totalAmount: 5000,  job: { jobType: 'REPAIR'  } },
        ]);
        db.stockLedger.findMany.mockResolvedValue([
            { change: -2, sparePart: { boughtPrice: 800 } }, // COGS: 1600
        ]);

        const res = await request(app)
            .post('/api/voice/query')
            .set('Authorization', managerToken())
            .send({ text: 'What is our profit this month?' });

        expect(res.status).toBe(200);
        expect(res.body.intent).toBe('financial_query');
        expect(res.body.data.revenue).toBe(15000);
        expect(res.body.data.cogs).toBe(1600);
        expect(res.body.data.grossProfit).toBe(13400);
    });

    test('general intent — no DB query executed', async () => {
        mockAxios.post.mockResolvedValueOnce({
            data: {
                choices: [{
                    message: {
                        content: JSON.stringify({
                            response: 'I can help you look up vehicles, inventory, staff, and financials.',
                            intent:   'general',
                            params:   { vehicleNumber: null, partName: null, employeeName: null, period: null, category: null },
                        }),
                    },
                }],
            },
        });

        const res = await request(app)
            .post('/api/voice/query')
            .set('Authorization', managerToken())
            .send({ text: 'What can you do?' });

        expect(res.status).toBe(200);
        expect(res.body.intent).toBe('general');
        // No DB calls for general intent
        expect(db.vehicle.findUnique).not.toHaveBeenCalled();
        expect(db.sparePart.findMany).not.toHaveBeenCalled();
    });

    test('400 — empty text and no audio returns error', async () => {
        // Route returns 400 before reaching the Groq API — no axios mock needed.
        const res = await request(app)
            .post('/api/voice/query')
            .set('Authorization', managerToken())
            .send({ text: '   ' }); // whitespace only — trims to ''

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/no audio or text/i);
    });

    test('context-aware query — uses page vehicleNumber when not mentioned in query', async () => {
        mockAxios.post.mockResolvedValueOnce({
            data: {
                choices: [{
                    message: {
                        content: JSON.stringify({
                            response: 'Fetching history for this vehicle.',
                            intent:   'vehicle_history',
                            params:   { vehicleNumber: null, partName: null, employeeName: null, period: null, category: null },
                        }),
                    },
                }],
            },
        });

        db.vehicle.findUnique.mockResolvedValue({
            vehicleNumber: 'WP-CTX-0001', ownerName: 'Context Test',
            jobs: [],
        });

        const res = await request(app)
            .post('/api/voice/query')
            .set('Authorization', managerToken())
            .send({
                text:    'Show me the history for this vehicle',
                context: JSON.stringify({ vehicleNumber: 'WP-CTX-0001' }), // page context
            });

        expect(res.status).toBe(200);
        // The route uses context.vehicleNumber when params.vehicleNumber is null
        expect(db.vehicle.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { vehicleNumber: 'WP-CTX-0001' } }),
        );
    });
});
