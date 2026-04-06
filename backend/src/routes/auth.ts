import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../lib/prisma';

const router = Router();

const signupSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['EMPLOYEE', 'ADMIN', 'MANAGER']),
});

const signinSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

// POST /api/auth/signup
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
    try {
        const data = signupSchema.parse(req.body);

        // Enforce max 2 admins and 2 managers
        if (data.role === 'ADMIN' || data.role === 'MANAGER') {
            const count = await prisma.user.count({ where: { role: data.role } });
            if (count >= 2) {
                res.status(400).json({
                    error: `Maximum 2 ${data.role.toLowerCase()}s are allowed. Registration closed.`,
                });
                return;
            }
        }

        const existing = await prisma.user.findUnique({ where: { email: data.email } });
        if (existing) {
            res.status(400).json({ error: 'Email already registered' });
            return;
        }

        const hashedPassword = await bcrypt.hash(data.password, 10);
        const user = await prisma.user.create({
            data: {
                name: data.name,
                email: data.email,
                password: hashedPassword,
                role: data.role,
            },
            select: { id: true, name: true, email: true, role: true, createdAt: true },
        });

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        res.status(201).json({ user, token });
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: error.errors });
            return;
        }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /api/auth/signin
router.post('/signin', async (req: Request, res: Response): Promise<void> => {
    try {
        const data = signinSchema.parse(req.body);

        const user = await prisma.user.findUnique({ where: { email: data.email } });
        if (!user) {
            res.status(400).json({ error: 'Invalid credentials' });
            return;
        }

        const valid = await bcrypt.compare(data.password, user.password);
        if (!valid) {
            res.status(400).json({ error: 'Invalid credentials' });
            return;
        }

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        res.json({
            user: { id: user.id, name: user.name, email: user.email, role: user.role },
            token,
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            res.status(400).json({ error: error.errors });
            return;
        }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// GET /api/auth/role-availability - check if admin/manager slots open
router.get('/role-availability', async (_req: Request, res: Response): Promise<void> => {
    try {
        const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
        const managerCount = await prisma.user.count({ where: { role: 'MANAGER' } });
        res.json({
            ADMIN: { count: adminCount, available: adminCount < 2 },
            MANAGER: { count: managerCount, available: managerCount < 2 },
            EMPLOYEE: { available: true },
        });
    } catch {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
