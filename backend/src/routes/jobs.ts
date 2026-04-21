/**
 * jobs.ts — Job Card Routes
 *
 * Manages the full lifecycle of a vehicle service/repair job card:
 *
 *   POST   /api/jobs            – Employee creates a new job (status: DRAFT)
 *   PUT    /api/jobs/:id/submit – Employee submits a draft job for admin review (DRAFT → SUBMITTED)
 *   GET    /api/jobs            – List jobs (employees see own; admin sees submitted/reviewed/quoted)
 *   GET    /api/jobs/:id        – Get a single job with all related data
 *   PUT    /api/jobs/:id/review – Admin marks a submitted job as reviewed (SUBMITTED → REVIEWED)
 *   PUT    /api/jobs/:id        – Employee edits a draft job before submission
 *
 * Job status flow:
 *   DRAFT → SUBMITTED → REVIEWED → QUOTED → FINALIZED → COMPLETED
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// ── Input Validation Schema ───────────────────────────────────────────────────

/**
 * Validates the request body when creating a new job.
 * insuranceCompany is only required for ACCIDENT_RECOVERY jobs (enforced on the frontend).
 */
const createJobSchema = z.object({
    vehicleNumber: z.string().min(1),
    jobType: z.enum(['SERVICE', 'REPAIR', 'ACCIDENT_RECOVERY']),
    notes: z.string().optional(),
    insuranceCompany: z.string().optional(),
});

// ── POST /api/jobs ────────────────────────────────────────────────────────────
/**
 * Creates a new job card in DRAFT status.
 * If the vehicle number is not already in the database, a new Vehicle record is created automatically.
 * Only EMPLOYEE role can create jobs.
 */
router.post('/', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const data = createJobSchema.parse(req.body);

        // Find or auto-create the vehicle record by registration number
        let vehicle = await prisma.vehicle.findUnique({ where: { vehicleNumber: data.vehicleNumber } });
        if (!vehicle) {
            vehicle = await prisma.vehicle.create({ data: { vehicleNumber: data.vehicleNumber } });
        }

        // Create the job in DRAFT state — the employee must explicitly submit it when ready
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

// ── PUT /api/jobs/:id/submit ──────────────────────────────────────────────────
/**
 * Transitions a job from DRAFT to SUBMITTED, making it visible to admin.
 * Enforces ownership — an employee can only submit their own jobs.
 * Prevents re-submission of already-submitted jobs.
 */
router.put('/:id/submit', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const job = await prisma.job.findUnique({ where: { id: req.params.id } });
        if (!job) { res.status(404).json({ error: 'Job not found' }); return; }

        // Ownership check — employees cannot submit jobs that belong to others
        if (job.employeeId !== req.user!.id) { res.status(403).json({ error: 'Not your job' }); return; }

        // Idempotency guard — avoids confusing the user with a silent duplicate submit
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

// ── GET /api/jobs ─────────────────────────────────────────────────────────────
/**
 * Returns a role-filtered list of jobs:
 *   EMPLOYEE  – Only their own jobs (all statuses)
 *   ADMIN     – All jobs in SUBMITTED, REVIEWED, or QUOTED status (work queue)
 *   MANAGER   – All jobs (no filter)
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const role = req.user!.role;

        // Build the filter based on the caller's role
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
                quotations: { select: { id: true, status: true } }, // Summary only — no full quotation data
            },
            orderBy: { createdAt: 'desc' },
        });

        res.json(jobs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/jobs/:id ─────────────────────────────────────────────────────────
/**
 * Returns a single job with its full related data:
 * vehicle details, employee info, uploaded images, and all linked quotations (with items).
 */
router.get('/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const job = await prisma.job.findUnique({
            where: { id: req.params.id },
            include: {
                vehicle: true,
                employee: { select: { id: true, name: true, email: true } },
                images: true,
                quotations: { include: { items: true } }, // Full quotation data including line items
            },
        });
        if (!job) { res.status(404).json({ error: 'Job not found' }); return; }
        res.json(job);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── PUT /api/jobs/:id/review ──────────────────────────────────────────────────
/**
 * Admin acknowledges a submitted job by marking it as REVIEWED.
 * This signals to the admin that the job is ready for a quotation to be created.
 */
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

// ── PUT /api/jobs/:id ─────────────────────────────────────────────────────────
/**
 * Allows an employee to edit a job that is still in DRAFT status.
 * Once submitted, jobs are locked to prevent changes after admin review.
 * Supports updating notes, voice note URL, insurance company, and job type.
 */
router.put('/:id', authenticate, requireRole('EMPLOYEE'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const job = await prisma.job.findUnique({ where: { id: req.params.id } });
        if (!job) { res.status(404).json({ error: 'Job not found' }); return; }

        // Ownership check — employees can only edit jobs they created
        if (job.employeeId !== req.user!.id) { res.status(403).json({ error: 'Not your job' }); return; }

        // Prevent edits to jobs already in the admin's work queue
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
