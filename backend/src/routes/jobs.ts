import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

const createJobSchema = z.object({
    vehicleNumber: z.string().min(1),
    jobType: z.enum(['SERVICE', 'REPAIR', 'ACCIDENT_RECOVERY']),
    notes: z.string().optional(),
    insuranceCompany: z.string().optional(),
});

// POST /api/jobs - employee creates job
router.post('/', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const data = createJobSchema.parse(req.body);

        // Find or create vehicle
        let vehicle = await prisma.vehicle.findUnique({ where: { vehicleNumber: data.vehicleNumber } });
        if (!vehicle) {
            vehicle = await prisma.vehicle.create({ data: { vehicleNumber: data.vehicleNumber } });
        }

        const job = await prisma.job.create({
            data: {
                vehicleId: vehicle.id,
                employeeId: req.user!.id,
                jobType: data.jobType,
                notes: data.notes,
                insuranceCompany: data.insuranceCompany,
                status: 'DRAFT',
            },
            include: { vehicle: true, employee: { select: { id: true, name: true } }, images: true },
        });

        res.status(201).json(job);
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/jobs/:id/submit - employee submits to admin
router.put('/:id/submit', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const job = await prisma.job.findUnique({ where: { id: req.params.id } });
        if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
        if (job.employeeId !== req.user!.id) { res.status(403).json({ error: 'Not your job' }); return; }
        if (job.status !== 'DRAFT') { res.status(400).json({ error: 'Job already submitted' }); return; }

        const updated = await prisma.job.update({
            where: { id: req.params.id },
            data: { status: 'SUBMITTED' },
            include: { vehicle: true, employee: { select: { id: true, name: true } }, images: true },
        });

        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/jobs - admin gets all submitted jobs; employee gets own jobs
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const role = req.user!.role;
        const where = role === 'EMPLOYEE'
            ? { employeeId: req.user!.id }
            : role === 'ADMIN'
                ? { status: { in: ['SUBMITTED', 'REVIEWED', 'QUOTED'] as Array<'SUBMITTED' | 'REVIEWED' | 'QUOTED'> } }
                : {};

        const jobs = await prisma.job.findMany({
            where,
            include: {
                vehicle: true,
                employee: { select: { id: true, name: true } },
                images: true,
                quotations: { select: { id: true, status: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(jobs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/jobs/:id - get single job details
router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const job = await prisma.job.findUnique({
            where: { id: req.params.id },
            include: {
                vehicle: true,
                employee: { select: { id: true, name: true, email: true } },
                images: true,
                quotations: { include: { items: true } },
            },
        });
        if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
        res.json(job);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/jobs/:id/review - admin marks as reviewed
router.put('/:id/review', authenticate, requireRole('ADMIN'), async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
        const job = await prisma.job.update({
            where: { id: _req.params.id },
            data: { status: 'REVIEWED' },
            include: { vehicle: true, images: true, employee: { select: { id: true, name: true } } },
        });
        res.json(job);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PUT /api/jobs/:id - employee updates draft job
router.put('/:id', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const job = await prisma.job.findUnique({ where: { id: req.params.id } });
        if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
        if (job.employeeId !== req.user!.id) { res.status(403).json({ error: 'Not your job' }); return; }
        if (job.status !== 'DRAFT') { res.status(400).json({ error: 'Cannot edit submitted job' }); return; }

        const { notes, voiceNoteUrl, insuranceCompany, jobType } = req.body;
        const updated = await prisma.job.update({
            where: { id: req.params.id },
            data: { notes, voiceNoteUrl, insuranceCompany, jobType },
            include: { vehicle: true, images: true },
        });
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
