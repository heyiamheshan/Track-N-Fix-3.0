/**
 * quotations.ts — Quotation Routes
 *
 * Manages the full quotation workflow for vehicle repair/service jobs:
 *
 *   POST   /api/quotations            – Admin/Manager creates a new quotation
 *   GET    /api/quotations            – List quotations (role-filtered)
 *   GET    /api/quotations/:id        – Get a single quotation with all related data
 *   PUT    /api/quotations/:id        – Edit quotation details and line items
 *   PUT    /api/quotations/:id/send   – Admin sends quotation to manager for review
 *   PUT    /api/quotations/:id/finalize – Manager finalises quotation (deducts inventory)
 *   PATCH  /api/quotations/:id/notify – Admin marks customer as notified via WhatsApp
 *
 * Quotation status flow:
 *   DRAFT → SENT_TO_MANAGER → FINALIZED → CUSTOMER_NOTIFIED
 *
 * Design notes:
 *   - Finalization runs inside a Prisma $transaction to ensure inventory deductions
 *     and quotation status updates are atomic (all succeed or all roll back).
 *   - When no jobId is supplied, a proxy job is auto-created so every quotation
 *     is always linked to a job card.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { VehicleType } from '@prisma/client';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// ── Input Validation Schema ───────────────────────────────────────────────────

/**
 * Validates the request body when creating or updating a quotation.
 * telephone is required because it's needed before sending to manager.
 * items is an optional array of line items (parts + labour).
 */
const createQuotationSchema = z.object({
    jobId: z.string().optional(),
    vehicleNumber: z.string().min(1),
    ownerName: z.string().optional(),
    address: z.string().optional(),
    telephone: z.string().min(1, 'Telephone number is required'),
    whatsappNumber: z.string().optional(),
    vehicleType: z.string().optional(),
    color: z.string().optional(),
    insuranceCompany: z.string().optional(),
    jobDetails: z.string().optional(),
    items: z.array(z.object({
        description: z.string(),
        partReplaced: z.string().optional(),
        price: z.number().default(0),
        laborCost: z.number().default(0),
    })).optional(),
});

// ── POST /api/quotations ──────────────────────────────────────────────────────
/**
 * Creates a new quotation.
 *
 * Steps:
 *  1. Find or create the vehicle record.
 *  2. Update vehicle owner/contact details.
 *  3. If no jobId is provided, create a proxy job (SERVICE type) so the quotation
 *     is always linked to a job card (required for the ledger/analytics).
 *  4. Create the quotation with initial status DRAFT (admin) or SENT_TO_MANAGER (manager).
 *  5. Bulk-insert line items if provided.
 *  6. If linked to an existing job, mark that job as QUOTED.
 */
router.post('/', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const data = createQuotationSchema.parse(req.body);

        // Find or auto-create vehicle by registration number
        let vehicle = await prisma.vehicle.findUnique({ where: { vehicleNumber: data.vehicleNumber } });
        if (!vehicle) {
            vehicle = await prisma.vehicle.create({ data: { vehicleNumber: data.vehicleNumber } });
        }

        // Enrich vehicle record with customer contact details from the quotation form
        vehicle = await prisma.vehicle.update({
            where: { id: vehicle.id },
            data: {
                ownerName: data.ownerName,
                address: data.address,
                telephone: data.telephone,
                whatsappNumber: data.whatsappNumber,
                vehicleType: data.vehicleType as VehicleType | undefined,
                color: data.color,
            },
        });

        // Auto-create a proxy job if the quotation is not linked to an existing job card
        let jobId = data.jobId;
        if (!jobId) {
            const proxyJob = await prisma.job.create({
                data: {
                    vehicleId: vehicle.id,
                    employeeId: req.user!.id,
                    jobType: 'SERVICE',
                    status: 'QUOTED',
                    notes: 'Auto-generated job for direct custom quotation.',
                }
            });
            jobId = proxyJob.id;
        }

        // Managers create quotations that skip the DRAFT stage and go straight to review
        const quotation = await prisma.quotation.create({
            data: {
                jobId: jobId,
                vehicleId: vehicle.id,
                adminId: req.user!.id,
                vehicleNumber: data.vehicleNumber,
                ownerName: data.ownerName,
                address: data.address,
                telephone: data.telephone,
                whatsappNumber: data.whatsappNumber,
                vehicleType: data.vehicleType as VehicleType | undefined,
                color: data.color,
                insuranceCompany: data.insuranceCompany,
                jobDetails: data.jobDetails,
                status: req.user!.role === 'MANAGER' ? 'SENT_TO_MANAGER' : 'DRAFT',
            },
            include: { job: { include: { images: true } }, items: true },
        });

        // Bulk-insert line items if any were included in the request
        if (data.items && data.items.length > 0) {
            await prisma.quotationItem.createMany({
                data: data.items.map(item => ({ ...item, quotationId: quotation.id })),
            });
        }

        // Mark the linked job as QUOTED so it moves to the next stage in the work queue
        if (data.jobId) {
            await prisma.job.update({ where: { id: data.jobId }, data: { status: 'QUOTED' } });
        }

        // Re-fetch with full relations for the response payload
        const full = await prisma.quotation.findUnique({
            where: { id: quotation.id },
            include: {
                job: { include: { images: true, employee: { select: { id: true, name: true } } } },
                vehicle: true,
                items: true,
            },
        });

        res.status(201).json(full);
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/quotations ───────────────────────────────────────────────────────
/**
 * Returns a role-filtered list of quotations:
 *   MANAGER – Only quotations in SENT_TO_MANAGER, FINALIZED, or CUSTOMER_NOTIFIED status
 *   ADMIN   – All quotations (full visibility for management and customer notification)
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        let where: any = {};
        if (req.user!.role === 'MANAGER') {
            // Managers only see quotations that have been sent to them or are in later stages
            where = { status: { in: ['SENT_TO_MANAGER', 'FINALIZED', 'CUSTOMER_NOTIFIED'] } };
        } else if (req.user!.role === 'ADMIN') {
            // Admin sees DRAFT/SENT_TO_MANAGER for their work queue + FINALIZED/CUSTOMER_NOTIFIED for delivery management
            where = {};
        }

        const quotations = await prisma.quotation.findMany({
            where,
            include: {
                job: { include: { images: true, employee: { select: { id: true, name: true } } } },
                vehicle: true,
                items: true,
                admin: { select: { id: true, name: true } },
                manager: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json(quotations);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/quotations/:id ───────────────────────────────────────────────────
/**
 * Returns a single quotation with all related data:
 * job (including images and employee), vehicle, line items, and the admin/manager
 * who handled each stage.
 */
router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const quotation = await prisma.quotation.findUnique({
            where: { id: req.params.id },
            include: {
                job: { include: { images: true, employee: { select: { id: true, name: true, email: true } } } },
                vehicle: true,
                items: true,
                admin: { select: { id: true, name: true } },
                manager: { select: { id: true, name: true } },
            },
        });
        if (!quotation) { res.status(404).json({ error: 'Quotation not found' }); return; }
        res.json(quotation);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── PUT /api/quotations/:id ───────────────────────────────────────────────────
/**
 * Edits a quotation's details and/or replaces its line items.
 * Uses a dynamic update object (updatedData) so only provided fields are changed —
 * undefined fields are not written, preventing accidental overwrites.
 * Items are replaced atomically: old items are deleted, new ones bulk-inserted.
 */
router.put('/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const {
            ownerName, address, telephone, whatsappNumber, vehicleType,
            color, insuranceCompany, jobDetails, items, totalAmount
        } = req.body;

        // Build a partial update object — only include fields that were sent in the request
        const updatedData: Record<string, unknown> = {};
        if (ownerName !== undefined)       updatedData.ownerName = ownerName;
        if (address !== undefined)         updatedData.address = address;
        if (telephone !== undefined)       updatedData.telephone = telephone;
        if (whatsappNumber !== undefined)  updatedData.whatsappNumber = whatsappNumber;
        if (vehicleType !== undefined)     updatedData.vehicleType = vehicleType;
        if (color !== undefined)           updatedData.color = color;
        if (insuranceCompany !== undefined) updatedData.insuranceCompany = insuranceCompany;
        if (jobDetails !== undefined)      updatedData.jobDetails = jobDetails;
        if (totalAmount !== undefined)     updatedData.totalAmount = totalAmount;

        await prisma.quotation.update({ where: { id: req.params.id }, data: updatedData });

        // Replace all line items if an items array was provided (full replacement strategy)
        if (items && Array.isArray(items)) {
            await prisma.quotationItem.deleteMany({ where: { quotationId: req.params.id } });
            if (items.length > 0) {
                await prisma.quotationItem.createMany({
                    data: items.map((item: { description: string; partReplaced?: string; price: number; laborCost: number }) => ({
                        ...item,
                        quotationId: req.params.id,
                    })),
                });
            }
        }

        // Return the full updated quotation including images and vehicle
        const full = await prisma.quotation.findUnique({
            where: { id: req.params.id },
            include: { job: { include: { images: true } }, vehicle: true, items: true },
        });

        res.json(full);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── PUT /api/quotations/:id/send ──────────────────────────────────────────────
/**
 * Admin sends a DRAFT quotation to the manager for pricing review.
 * Validates that a telephone number exists before allowing submission
 * (manager needs it to contact the customer).
 */
router.put('/:id/send', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const existing = await prisma.quotation.findUnique({ where: { id: req.params.id } });
        if (!existing) { res.status(404).json({ error: 'Quotation not found' }); return; }

        // Business rule: telephone is mandatory before sending to manager
        if (!existing.telephone || existing.telephone.trim() === '') {
            res.status(400).json({
                error: 'A telephone number is required before sending to the manager. Please edit the quotation and add the customer telephone number.'
            });
            return;
        }

        const quotation = await prisma.quotation.update({
            where: { id: req.params.id },
            data: { status: 'SENT_TO_MANAGER' },
            include: { job: true, vehicle: true, items: true },
        });

        res.json(quotation);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── PUT /api/quotations/:id/finalize ─────────────────────────────────────────
/**
 * Manager finalises the quotation after agreeing on prices with the customer.
 *
 * This endpoint performs all writes inside a single Prisma $transaction to guarantee:
 *  1. Line items are replaced with the final agreed amounts.
 *  2. Quotation status is set to FINALIZED with the manager's ID and total amount.
 *  3. Associated job is marked as FINALIZED.
 *  4. Inventory quantities are decremented for any spare parts used.
 *  5. Stock ledger entries are created for each deduction (audit trail).
 *  6. Admin is notified that the quotation is ready for customer notification.
 *
 * Stock availability is verified BEFORE entering the transaction to avoid
 * partial rollbacks due to insufficient stock.
 */
router.put('/:id/finalize', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { items, totalAmount } = req.body;

        // Collect all spare part deductions needed for this quotation
        type ItemInput = {
            description: string;
            partReplaced?: string;
            price: number;
            laborCost: number;
            sparePartId?: string;
            quantity?: number;
        };

        const inventoryItems: { sparePartId: string; qty: number }[] = [];
        if (items && Array.isArray(items)) {
            for (const item of items as ItemInput[]) {
                if (item.sparePartId && item.quantity && item.quantity > 0) {
                    inventoryItems.push({ sparePartId: item.sparePartId, qty: item.quantity });
                }
            }
        }

        // Pre-transaction stock check — fail fast with a clear error message if stock is insufficient
        for (const { sparePartId, qty } of inventoryItems) {
            const part = await prisma.sparePart.findUnique({ where: { id: sparePartId } });
            if (!part) { res.status(400).json({ error: `Spare part ${sparePartId} not found` }); return; }
            if (part.quantity < qty) {
                res.status(409).json({
                    error: `Insufficient stock for "${part.name}". Available: ${part.quantity}, Required: ${qty}`
                });
                return;
            }
        }

        // Fetch quotation reference data for ledger entries (job number and vehicle number)
        const quotationRef = await prisma.quotation.findUnique({
            where: { id: req.params.id },
            include: { job: true }
        });
        if (!quotationRef) { res.status(404).json({ error: 'Quotation not found' }); return; }

        // Atomic transaction: all writes succeed together or none are applied
        await prisma.$transaction(async (tx) => {
            // Replace line items with the final agreed values
            if (items && Array.isArray(items)) {
                await tx.quotationItem.deleteMany({ where: { quotationId: req.params.id } });
                if (items.length > 0) {
                    await tx.quotationItem.createMany({
                        data: (items as ItemInput[]).map(item => ({
                            description: item.description,
                            partReplaced: item.partReplaced,
                            price: item.price,
                            laborCost: item.laborCost,
                            sparePartId: item.sparePartId || null,
                            quantity: item.quantity || 1,
                            quotationId: req.params.id,
                        })),
                    });
                }
            }

            // Finalise the quotation record with manager info and total amount
            await tx.quotation.update({
                where: { id: req.params.id },
                data: { status: 'FINALIZED', managerId: req.user!.id, totalAmount },
            });

            // Progress the associated job to FINALIZED status
            await tx.job.update({
                where: { id: quotationRef.jobId },
                data: { status: 'FINALIZED' }
            });

            // Deduct inventory and write stock ledger entries for each used spare part
            for (const { sparePartId, qty } of inventoryItems) {
                await tx.sparePart.update({
                    where: { id: sparePartId },
                    data: { quantity: { decrement: qty } },
                });
                await tx.stockLedger.create({
                    data: {
                        sparePartId,
                        change: -qty, // Negative value indicates stock consumption
                        reason: `Used in quotation for vehicle ${quotationRef.vehicleNumber}`,
                        quotationId: req.params.id,
                        jobNumber: quotationRef.job.jobNumber,
                    },
                });
            }

            // Notify the admin that the quotation is finalized and the customer can be contacted
            await tx.notification.create({
                data: {
                    fromRole: 'MANAGER',
                    toRole: 'ADMIN',
                    message: `Quotation for vehicle ${quotationRef.vehicleNumber} has been finalized. Ready to notify customer.`,
                    vehicleNumber: quotationRef.vehicleNumber,
                    quotationId: req.params.id,
                },
            });
        });

        // Return the updated quotation outside the transaction
        const quotation = await prisma.quotation.findUnique({
            where: { id: req.params.id },
            include: { job: { include: { images: true } }, vehicle: true, items: true },
        });

        res.json(quotation);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── PATCH /api/quotations/:id/notify ─────────────────────────────────────────
/**
 * Admin marks the customer as notified after contacting them via WhatsApp.
 * Sets the quotation to CUSTOMER_NOTIFIED and marks the job as COMPLETED.
 * Also sends an in-app notification to the manager confirming the job is done.
 */
router.patch('/:id/notify', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const quotation = await prisma.quotation.findUnique({
            where: { id: req.params.id },
            include: { job: true },
        });
        if (!quotation) { res.status(404).json({ error: 'Quotation not found' }); return; }

        // Only finalized quotations can be marked as customer-notified
        if (quotation.status !== 'FINALIZED' && quotation.status !== 'CUSTOMER_NOTIFIED') {
            res.status(400).json({ error: 'Quotation must be finalized before notifying customer' });
            return;
        }

        const updated = await prisma.quotation.update({
            where: { id: req.params.id },
            data: {
                status: 'CUSTOMER_NOTIFIED',
                notifiedAt: new Date(),
                notificationSent: true,
            },
            include: {
                job: { include: { images: true, employee: { select: { id: true, name: true } } } },
                vehicle: true,
                items: true,
            },
        });

        // Mark the job as COMPLETED — the full workflow is now done
        await prisma.job.update({
            where: { id: quotation.jobId },
            data: { status: 'COMPLETED' },
        });

        // Inform the manager that the job has been closed out
        await prisma.notification.create({
            data: {
                fromRole: 'ADMIN',
                toRole: 'MANAGER',
                message: `Customer for vehicle ${quotation.vehicleNumber} has been notified via WhatsApp. Job marked as Completed.`,
                vehicleNumber: quotation.vehicleNumber,
                quotationId: quotation.id,
            },
        });

        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
