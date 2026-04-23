/**
 * inventory.ts — Spare Parts Inventory Routes
 *
 * Provides full CRUD management for the spare parts inventory and a stock ledger
 * for audit-trail tracking of every quantity change.
 *
 *   GET    /api/inventory               – List all spare parts with total inventory value (Manager only)
 *   GET    /api/inventory/search?q=...  – Search parts by name or serial number (Manager only)
 *   POST   /api/inventory               – Add a new spare part (Manager only)
 *   PUT    /api/inventory/:id           – Edit part details or manually adjust stock (Manager only)
 *   DELETE /api/inventory/:id           – Remove a part from inventory (Manager only)
 *   GET    /api/inventory/:id/ledger    – View the stock change history for a part (Manager only)
 *
 * Stock ledger notes:
 *   - Every stock change (manual adjustment or quotation deduction) creates a StockLedger record.
 *   - Positive change values = stock added; negative values = stock consumed.
 *   - Serial numbers must be unique; duplicate attempts return 409 Conflict.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// ── Input Validation Schema ───────────────────────────────────────────────────

/**
 * Validates the request body for creating a new spare part.
 * lowStockThreshold defaults to 5 — the manager will be alerted when
 * quantity drops below this value.
 */
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

// ── GET /api/inventory ────────────────────────────────────────────────────────
/**
 * Returns all spare parts ordered by most recently added, plus the aggregate
 * total inventory value (boughtPrice × quantity across all parts).
 * The total value is used on the manager dashboard's financial summary card.
 */
router.get('/', authenticate, requireRole('MANAGER'), async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
        const parts = await prisma.sparePart.findMany({
            orderBy: { createdAt: 'desc' },
        });

        // Calculate total capital tied up in inventory
        const totalValue = parts.reduce((sum, p) => sum + p.boughtPrice * p.quantity, 0);
        res.json({ parts, totalValue });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/inventory/search ─────────────────────────────────────────────────
/**
 * Case-insensitive search across part names and serial numbers.
 * Limited to 20 results to keep response sizes manageable.
 * Used by the quotation form's spare-part selector for fast lookup.
 */
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
            take: 20, // Cap results to prevent large payloads
        });
        res.json(parts);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/inventory ───────────────────────────────────────────────────────
/**
 * Adds a new spare part to inventory.
 * Serial numbers are unique at the database level (Prisma P2002 error).
 * purchaseDate is stored as a Date object if provided as an ISO string.
 */
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
        // Handle unique constraint violation on serialNumber
        if ((error as any)?.code === 'P2002') { res.status(409).json({ error: 'Serial number already exists' }); return; }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── PUT /api/inventory/:id ────────────────────────────────────────────────────
/**
 * Updates spare part details and/or adjusts stock quantity.
 *
 * Only fields explicitly sent in the request body are updated (partial update).
 * When the quantity changes, a StockLedger entry is automatically created to
 * record who changed it, by how much, and why (adjustmentReason).
 */
router.put('/:id', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const existing = await prisma.sparePart.findUnique({ where: { id: req.params.id } });
        if (!existing) { res.status(404).json({ error: 'Part not found' }); return; }

        const {
            name, serialNumber, description, boughtPrice, sellingPrice,
            quantity, lowStockThreshold, supplierName, supplierDetails,
            purchaseDate, adjustmentReason,
        } = req.body;

        // Build a partial update object — only include fields present in the request
        const updateData: Record<string, unknown> = {};
        if (name !== undefined)             updateData.name = name;
        if (serialNumber !== undefined)     updateData.serialNumber = serialNumber;
        if (description !== undefined)      updateData.description = description;
        if (boughtPrice !== undefined)      updateData.boughtPrice = boughtPrice;
        if (sellingPrice !== undefined)     updateData.sellingPrice = sellingPrice;
        if (lowStockThreshold !== undefined) updateData.lowStockThreshold = lowStockThreshold;
        if (supplierName !== undefined)     updateData.supplierName = supplierName;
        if (supplierDetails !== undefined)  updateData.supplierDetails = supplierDetails;
        if (purchaseDate !== undefined)     updateData.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;

        // Handle manual stock adjustment — create a ledger entry for the difference
        if (quantity !== undefined && quantity !== existing.quantity) {
            const change = quantity - existing.quantity; // Positive = added, negative = removed
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

// ── DELETE /api/inventory/:id ─────────────────────────────────────────────────
/**
 * Permanently removes a spare part and its associated stock ledger entries.
 * Only use for parts that were added by mistake; prefer setting quantity to 0
 * for parts that are simply out of stock but may be re-ordered.
 */
router.delete('/:id', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        await prisma.sparePart.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/inventory/:id/ledger ─────────────────────────────────────────────
/**
 * Returns the complete stock change history for a specific spare part,
 * most recent first. Each entry records the change amount, reason, and
 * the quotation/job number if the change was caused by a finalized quotation.
 */
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
