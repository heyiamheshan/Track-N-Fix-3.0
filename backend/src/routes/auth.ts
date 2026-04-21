import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// ── Mailer setup ─────────────────────────────────────────────
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

const signinSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

const changePasswordSchema = z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(6),
});

// ── POST /api/auth/signin ────────────────────────────────────
router.post('/signin', async (req: Request, res: Response): Promise<void> => {
    try {
        const data = signinSchema.parse(req.body);

        const user = await prisma.user.findUnique({ where: { email: data.email } });
        if (!user) {
            res.status(400).json({ error: 'Invalid credentials' });
            return;
        }
        if (!user.isActive) {
            res.status(403).json({ error: 'Account has been deactivated. Contact your admin.' });
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
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                isFirstLogin: user.isFirstLogin,
            },
            token,
        });
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/auth/signup (Admin/Manager self-registration only) ──
const signupSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['ADMIN', 'MANAGER']),
});

router.post('/signup', async (req: Request, res: Response): Promise<void> => {
    try {
        const data = signupSchema.parse(req.body);

        const count = await prisma.user.count({ where: { role: data.role } });
        if (count >= 2) {
            res.status(400).json({ error: `Maximum 2 ${data.role.toLowerCase()}s are allowed.` });
            return;
        }

        const existing = await prisma.user.findUnique({ where: { email: data.email } });
        if (existing) { res.status(400).json({ error: 'Email already registered' }); return; }

        const hashedPassword = await bcrypt.hash(data.password, 10);
        const user = await prisma.user.create({
            data: {
                name: data.name,
                email: data.email,
                password: hashedPassword,
                role: data.role,
                isFirstLogin: false, // admins/managers set their own password
            },
            select: { id: true, name: true, email: true, role: true, isFirstLogin: true, createdAt: true },
        });

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '7d' }
        );

        res.status(201).json({ user, token });
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/auth/change-password (first-login mandatory change) ──
router.post('/change-password', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

        const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
        if (!user) { res.status(404).json({ error: 'User not found' }); return; }

        const valid = await bcrypt.compare(currentPassword, user.password);
        if (!valid) { res.status(400).json({ error: 'Current password is incorrect' }); return; }

        const hashed = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashed, isFirstLogin: false },
        });

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/auth/forgot-password ──────────────────────────
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email } = z.object({ email: z.string().email() }).parse(req.body);

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            // Return 200 to prevent user enumeration
            res.json({ message: 'If that email exists, an OTP has been sent.' });
            return;
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await prisma.user.update({
            where: { id: user.id },
            data: { otpCode: otp, otpExpiry: expiry },
        });

        await transporter.sendMail({
            from: `"TrackNFix System" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'TrackNFix – Password Reset OTP',
            html: `
                <div style="font-family:sans-serif;max-width:420px;margin:auto">
                    <h2 style="color:#3b82f6">TrackNFix 3.0</h2>
                    <p>Your one-time password reset code is:</p>
                    <div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#1e293b;background:#f1f5f9;padding:18px;border-radius:8px;text-align:center">${otp}</div>
                    <p style="color:#64748b;font-size:13px">This code expires in <strong>10 minutes</strong>. Do not share it with anyone.</p>
                </div>
            `,
        });

        res.json({ message: 'If that email exists, an OTP has been sent.' });
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        console.error('OTP email error:', error);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
});

// ── POST /api/auth/verify-otp ────────────────────────────────
router.post('/verify-otp', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, otp } = z.object({ email: z.string().email(), otp: z.string().length(6) }).parse(req.body);

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || user.otpCode !== otp || !user.otpExpiry || user.otpExpiry < new Date()) {
            res.status(400).json({ error: 'Invalid or expired OTP' });
            return;
        }

        // Generate a short-lived reset token
        const resetToken = jwt.sign(
            { id: user.id, purpose: 'reset' },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '15m' }
        );

        // Consume the OTP
        await prisma.user.update({ where: { id: user.id }, data: { otpCode: null, otpExpiry: null } });

        res.json({ resetToken });
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/auth/reset-password ───────────────────────────
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
    try {
        const { resetToken, newPassword } = z.object({
            resetToken: z.string(),
            newPassword: z.string().min(6),
        }).parse(req.body);

        let payload: any;
        try {
            payload = jwt.verify(resetToken, process.env.JWT_SECRET || 'secret') as any;
        } catch {
            res.status(400).json({ error: 'Invalid or expired reset token' });
            return;
        }
        if (payload.purpose !== 'reset') {
            res.status(400).json({ error: 'Invalid reset token' });
            return;
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: payload.id },
            data: { password: hashed, isFirstLogin: false },
        });

        res.json({ message: 'Password reset successfully. Please sign in.' });
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── GET /api/auth/role-availability ─────────────────────────
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
