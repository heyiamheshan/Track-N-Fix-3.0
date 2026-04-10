import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

const sparePartSchema = z.object({
    name: z.string().min(1),
    serialNumber: z.string().min(1),
    description: z.string().optional(),
    boughtPrice: z.number().min(0),
    sellingPrice: z.number().min(0),
    quantity: z.number().int().min(0),
    lowStockThreshold: z.number().int().min(0).default(5),
    supplierName: z.string().optional(),
    supplierDetails: z.string().optional(),
    purchaseDate: z.string().optional(),
});

// GET /api/inventory - list all parts (Manager only)
router.get('/', authenticate, requireRole('MANAGER'), async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
        const parts = await prisma.sparePart.findMany({
            orderBy: { createdAt: 'desc' },
        });
        const totalValue = parts.reduce((sum, p) => sum + p.boughtPrice * p.quantity, 0);
        res.json({ parts, totalValue });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/inventory/search?q=... - search parts by name or serial (Manager only)
router.get('/search', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const q = (req.query.q as string) || '';
        const parts = await prisma.sparePart.findMany({
            where: {
                OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { serialNumber: { contains: q, mode: 'insensitive' } },
                ],
            },
            orderBy: { name: 'asc' },
            take: 20,
        });
        res.json(parts);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/inventory - add new part (Manager only)
router.post('/', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const data = sparePartSchema.parse(req.body);
        const part = await prisma.sparePart.create({
            data: {
                ...data,
                purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
            },
        });
        res.status(201).json(part);
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        if ((error as any)?.code === 'P2002') { res.status(409).json({ error: 'Serial number already exists' }); return; }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/inventory/:id - update part or manually adjust stock (Manager only)
router.put('/:id', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const existing = await prisma.sparePart.findUnique({ where: { id: req.params.id } });
        if (!existing) { res.status(404).json({ error: 'Part not found' }); return; }

        const {
            name, serialNumber, description, boughtPrice, sellingPrice,
            quantity, lowStockThreshold, supplierName, supplierDetails, purchaseDate,
            adjustmentReason,
        } = req.body;

        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = name;
        if (serialNumber !== undefined) updateData.serialNumber = serialNumber;
        if (description !== undefined) updateData.description = description;
        if (boughtPrice !== undefined) updateData.boughtPrice = boughtPrice;
        if (sellingPrice !== undefined) updateData.sellingPrice = sellingPrice;
        if (lowStockThreshold !== undefined) updateData.lowStockThreshold = lowStockThreshold;
        if (supplierName !== undefined) updateData.supplierName = supplierName;
        if (supplierDetails !== undefined) updateData.supplierDetails = supplierDetails;
        if (purchaseDate !== undefined) updateData.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;

        // Handle manual stock adjustment with ledger entry
        if (quantity !== undefined && quantity !== existing.quantity) {
            const change = quantity - existing.quantity;
            updateData.quantity = quantity;
            await prisma.stockLedger.create({
                data: {
                    sparePartId: existing.id,
                    change,
                    reason: adjustmentReason || 'Manual adjustment by manager',
                },
            });
        }

        const updated = await prisma.sparePart.update({ where: { id: req.params.id }, data: updateData });
        res.json(updated);
    } catch (error) {
        if ((error as any)?.code === 'P2002') { res.status(409).json({ error: 'Serial number already exists' }); return; }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE /api/inventory/:id - delete part (Manager only)
router.delete('/:id', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await prisma.sparePart.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/inventory/:id/ledger - stock ledger for a part (Manager only)
router.get('/:id/ledger', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const ledger = await prisma.stockLedger.findMany({
            where: { sparePartId: req.params.id },
            orderBy: { createdAt: 'desc' },
        });
        res.json(ledger);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
