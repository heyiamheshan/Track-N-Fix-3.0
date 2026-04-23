/**
 * employees.ts — Employee Management Routes
 *
 * Allows admins and managers to manage employee accounts:
 *
 *   GET   /api/employees          – List all employees with job count (Admin & Manager)
 *   POST  /api/employees          – Create a new employee account (Admin only)
 *   PATCH /api/employees/:id/status – Activate or deactivate an employee account (Admin only)
 *
 * Notes:
 *   - Employees are created by the admin (not self-registered).
 *   - A temporary password is set at creation; isFirstLogin = true forces
 *     the employee to change it on first sign-in.
 *   - Deactivated employees (isActive = false) cannot log in.
 */

import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { authenticate, requireRole, AuthRequest } from '../middleware/auth';

const router = Router();

// ── Input Validation Schema ───────────────────────────────────────────────────

/**
 * Validates the request body when creating a new employee.
 * nicNumber must be 9–12 characters to accommodate both old (9-digit) and new (12-character) Sri Lankan NICs.
 */
const createEmployeeSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    nicNumber: z.string().min(9).max(12),
    address: z.string().min(4),
    password: z.string().min(6),
});

// ── GET /api/employees ────────────────────────────────────────────────────────
/**
 * Returns all users with the EMPLOYEE role, including the total number of jobs
 * they have created (_count.jobs). Sorted by most recently created.
 * Accessible by both ADMIN and MANAGER so managers can view the team.
 */
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
                _count: { select: { jobs: true } }, // Aggregate job count without fetching job records
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(employees);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/employees ───────────────────────────────────────────────────────
/**
 * Creates a new employee account.
 * The admin sets a temporary password; isFirstLogin = true forces the employee
 * to change it immediately after their first sign-in.
 * Duplicate email and NIC checks prevent data integrity issues.
 */
router.post('/', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const data = createEmployeeSchema.parse(req.body);

        // Prevent duplicate email registrations across the entire user table
        const existingEmail = await prisma.user.findUnique({ where: { email: data.email } });
        if (existingEmail) { res.status(400).json({ error: 'Email already registered' }); return; }

        // Prevent duplicate NIC numbers (unique identifier per person in Sri Lanka)
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
                isFirstLogin: true,  // Forces password change on first login
                isActive: true,      // Account is active immediately after creation
            },
            // Only return safe fields — omit hashed password from the response
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

// ── PATCH /api/employees/:id/status ──────────────────────────────────────────
/**
 * Toggles the isActive flag for an employee account.
 * Deactivating prevents the employee from logging in without deleting their
 * historical job and attendance records.
 * Only ADMIN can change account status.
 */
router.patch('/:id/status', authenticate, requireRole('ADMIN'), async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);

        // Guard against accidentally targeting non-employee users (e.g., other admins)
        const employee = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (!employee || employee.role !== 'EMPLOYEE') {
            res.status(404).json({ error: 'Employee not found' }); return;
        }

        const updated = await prisma.user.update({
            where: { id: req.params.id },
            data: { isActive },
            select: { id: true, name: true, isActive: true }, // Minimal response — no sensitive data
        });

        res.json(updated);
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
