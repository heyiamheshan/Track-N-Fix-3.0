import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

const createQuotationSchema = z.object({
    jobId: z.string(),
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

// POST /api/quotations - admin creates quotation
router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
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

        const quotation = await prisma.quotation.create({
            data: {
                jobId: data.jobId,
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
                status: 'DRAFT',
            },
            include: { job: { include: { images: true } }, items: true },
        });

        // Create items if provided
        if (data.items && data.items.length > 0) {
            await prisma.quotationItem.createMany({
                data: data.items.map(item => ({ ...item, quotationId: quotation.id })),
            });
        }

        // Update job status to QUOTED
        await prisma.job.update({ where: { id: data.jobId }, data: { status: 'QUOTED' } });

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
        const where = req.user!.role === 'MANAGER' ? { status: 'SENT_TO_MANAGER' as const } : {};
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

        const quotation = await prisma.quotation.update({
            where: { id: req.params.id },
            data: {
                status: 'FINALIZED',
                managerId: req.user!.id,
                totalAmount,
            },
            include: { job: { include: { images: true } }, vehicle: true, items: true },
        });

        // Update job status
        await prisma.job.update({ where: { id: quotation.jobId }, data: { status: 'FINALIZED' } });

        // Notify admin
        await prisma.notification.create({
            data: {
                fromRole: 'MANAGER',
                toRole: 'ADMIN',
                message: `Quotation for vehicle ${quotation.vehicleNumber} has been finalized. Ready to notify customer.`,
                vehicleNumber: quotation.vehicleNumber,
                quotationId: quotation.id,
            },
        });

        res.json(quotation);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
