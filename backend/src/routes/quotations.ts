import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

const createQuotationSchema = z.object({
    jobId: z.string().optional(),
    vehicleNumber: z.string().min(1),
    ownerName: z.string().optional(),
    address: z.string().optional(),
    telephone: z.string().optional(),
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

// POST /api/quotations - admin/manager creates quotation
router.post('/', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const data = createQuotationSchema.parse(req.body);

        // Get vehicle
        let vehicle = await prisma.vehicle.findUnique({ where: { vehicleNumber: data.vehicleNumber } });
        if (!vehicle) {
            vehicle = await prisma.vehicle.create({ data: { vehicleNumber: data.vehicleNumber } });
        }

        // Update vehicle details
        vehicle = await prisma.vehicle.update({
            where: { id: vehicle.id },
            data: {
                ownerName: data.ownerName,
                address: data.address,
                telephone: data.telephone,
                vehicleType: data.vehicleType,
                color: data.color,
            },
        });

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

        const quotation = await prisma.quotation.create({
            data: {
                jobId: jobId,
                vehicleId: vehicle.id,
                adminId: req.user!.id,
                vehicleNumber: data.vehicleNumber,
                ownerName: data.ownerName,
                address: data.address,
                telephone: data.telephone,
                vehicleType: data.vehicleType,
                color: data.color,
                insuranceCompany: data.insuranceCompany,
                jobDetails: data.jobDetails,
                status: req.user!.role === 'MANAGER' ? 'SENT_TO_MANAGER' : 'DRAFT',
            },
            include: { job: { include: { images: true } }, items: true },
        });

        // Create items if provided
        if (data.items && data.items.length > 0) {
            await prisma.quotationItem.createMany({
                data: data.items.map(item => ({ ...item, quotationId: quotation.id })),
            });
        }

        // Update job status to QUOTED if it existed
        if (data.jobId) {
            await prisma.job.update({ where: { id: data.jobId }, data: { status: 'QUOTED' } });
        }

        const full = await prisma.quotation.findUnique({
            where: { id: quotation.id },
            include: { job: { include: { images: true, employee: { select: { id: true, name: true } } } }, vehicle: true, items: true },
        });

        res.status(201).json(full);
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/quotations - list quotations
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const where: any = req.user!.role === 'MANAGER' ? { status: { in: ['SENT_TO_MANAGER', 'FINALIZED'] } } : {};
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

// GET /api/quotations/:id - get single quotation
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

// PUT /api/quotations/:id - edit quotation
router.put('/:id', authenticate, requireRole('ADMIN', 'MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { ownerName, address, telephone, vehicleType, color, insuranceCompany, jobDetails, items, totalAmount } = req.body;

        const updatedData: Record<string, unknown> = {};
        if (ownerName !== undefined) updatedData.ownerName = ownerName;
        if (address !== undefined) updatedData.address = address;
        if (telephone !== undefined) updatedData.telephone = telephone;
        if (vehicleType !== undefined) updatedData.vehicleType = vehicleType;
        if (color !== undefined) updatedData.color = color;
        if (insuranceCompany !== undefined) updatedData.insuranceCompany = insuranceCompany;
        if (jobDetails !== undefined) updatedData.jobDetails = jobDetails;
        if (totalAmount !== undefined) updatedData.totalAmount = totalAmount;

        await prisma.quotation.update({ where: { id: req.params.id }, data: updatedData });

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

// PUT /api/quotations/:id/send - admin sends to manager
router.put('/:id/send', authenticate, requireRole('ADMIN'), async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
        const quotation = await prisma.quotation.update({
            where: { id: _req.params.id },
            data: { status: 'SENT_TO_MANAGER' },
            include: { job: true, vehicle: true, items: true },
        });
        res.json(quotation);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/quotations/:id/finalize - manager finalizes
router.put('/:id/finalize', authenticate, requireRole('MANAGER'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { items, totalAmount } = req.body;

        // Collect inventory deductions needed
        type ItemInput = { description: string; partReplaced?: string; price: number; laborCost: number; sparePartId?: string; quantity?: number };
        const inventoryItems: { sparePartId: string; qty: number }[] = [];
        if (items && Array.isArray(items)) {
            for (const item of items as ItemInput[]) {
                if (item.sparePartId && item.quantity && item.quantity > 0) {
                    inventoryItems.push({ sparePartId: item.sparePartId, qty: item.quantity });
                }
            }
        }

        // Verify sufficient stock before committing
        for (const { sparePartId, qty } of inventoryItems) {
            const part = await prisma.sparePart.findUnique({ where: { id: sparePartId } });
            if (!part) { res.status(400).json({ error: `Spare part ${sparePartId} not found` }); return; }
            if (part.quantity < qty) {
                res.status(409).json({ error: `Insufficient stock for "${part.name}". Available: ${part.quantity}, Required: ${qty}` });
                return;
            }
        }

        // Fetch job for ledger reference
        const quotationRef = await prisma.quotation.findUnique({ where: { id: req.params.id }, include: { job: true } });
        if (!quotationRef) { res.status(404).json({ error: 'Quotation not found' }); return; }

        // Atomic transaction: update items, finalize quotation, deduct inventory
        await prisma.$transaction(async (tx) => {
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

            await tx.quotation.update({
                where: { id: req.params.id },
                data: { status: 'FINALIZED', managerId: req.user!.id, totalAmount },
            });

            await tx.job.update({ where: { id: quotationRef.jobId }, data: { status: 'FINALIZED' } });

            // Deduct inventory and record ledger entries
            for (const { sparePartId, qty } of inventoryItems) {
                await tx.sparePart.update({
                    where: { id: sparePartId },
                    data: { quantity: { decrement: qty } },
                });
                await tx.stockLedger.create({
                    data: {
                        sparePartId,
                        change: -qty,
                        reason: `Used in quotation for vehicle ${quotationRef.vehicleNumber}`,
                        quotationId: req.params.id,
                        jobNumber: quotationRef.job.jobNumber,
                    },
                });
            }

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

export default router;
