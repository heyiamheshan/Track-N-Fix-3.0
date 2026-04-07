import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

const createEmployeeSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    nicNumber: z.string().min(9).max(12),
    address: z.string().min(4),
    password: z.string().min(6),
});

// GET /api/employees – Admin & Manager: list all employees with job count
router.get('/', authenticate, requireRole('ADMIN', 'MANAGER'), async (_req: AuthRequest, res: Response): Promise<void> => {
    try {
        const employees = await prisma.user.findMany({
            where: { role: 'EMPLOYEE' },
            select: {
                id: true,
                name: true,
                email: true,
                nicNumber: true,
                address: true,
                isActive: true,
                isFirstLogin: true,
                createdAt: true,
                _count: { select: { jobs: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(employees);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/employees – Admin only: create a new employee account
router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const data = createEmployeeSchema.parse(req.body);

        const existingEmail = await prisma.user.findUnique({ where: { email: data.email } });
        if (existingEmail) { res.status(400).json({ error: 'Email already registered' }); return; }

        const existingNIC = await prisma.user.findUnique({ where: { nicNumber: data.nicNumber } });
        if (existingNIC) { res.status(400).json({ error: 'NIC number already registered' }); return; }

        const hashedPassword = await bcrypt.hash(data.password, 10);
        const employee = await prisma.user.create({
            data: {
                name: data.name,
                email: data.email,
                nicNumber: data.nicNumber,
                address: data.address,
                password: hashedPassword,
                role: 'EMPLOYEE',
                isFirstLogin: true,
                isActive: true,
            },
            select: {
                id: true, name: true, email: true, nicNumber: true,
                address: true, isActive: true, isFirstLogin: true, createdAt: true,
            },
        });

        res.status(201).json(employee);
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/employees/:id/status – Admin only: toggle isActive
router.patch('/:id/status', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);

        const employee = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (!employee || employee.role !== 'EMPLOYEE') {
            res.status(404).json({ error: 'Employee not found' }); return;
        }

        const updated = await prisma.user.update({
            where: { id: req.params.id },
            data: { isActive },
            select: { id: true, name: true, isActive: true },
        });

        res.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
