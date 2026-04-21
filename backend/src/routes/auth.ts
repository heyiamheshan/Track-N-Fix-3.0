/**
 * auth.ts — Authentication Routes
 *
 * Handles all user authentication and password management flows:
 *
 *   POST /api/auth/signin             – Email/password login, returns JWT
 *   POST /api/auth/signup             – Self-registration for ADMIN and MANAGER roles (max 2 each)
 *   POST /api/auth/change-password    – First-login mandatory password change
 *   POST /api/auth/forgot-password    – Sends a 6-digit OTP to the user's email
 *   POST /api/auth/verify-otp         – Validates OTP, returns a short-lived reset token
 *   POST /api/auth/reset-password     – Sets a new password using the reset token
 *   GET  /api/auth/role-availability  – Reports how many ADMIN/MANAGER slots remain
 *
 * Security notes:
 *   - Passwords are hashed with bcrypt (10 salt rounds) before storage.
 *   - JWTs are signed with JWT_SECRET and expire after 7 days (15 min for reset tokens).
 *   - The forgot-password endpoint always returns 200 to prevent user enumeration.
 *   - OTPs expire after 10 minutes and are consumed (cleared) on first use.
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import prisma from '../lib/prisma';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

// ── Email Transporter Setup ───────────────────────────────────────────────────
// Uses Gmail SMTP over SSL (port 465). Credentials are read from .env to keep
// secrets out of source control.
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// ── Input Validation Schemas (Zod) ────────────────────────────────────────────
// Centralised schemas mean validation rules are defined once and reused.

/** Schema for the sign-in request body */
const signinSchema = z.object({
    email: z.string().email(),
    password: z.string(),
});

/** Schema for the change-password request body (requires current password) */
const changePasswordSchema = z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(6),
});

// ── POST /api/auth/signin ─────────────────────────────────────────────────────
/**
 * Authenticates a user with email and password.
 * Returns the user profile and a signed JWT on success.
 * Rejects deactivated accounts before checking the password.
 */
router.post('/signin', async (req: Request, res: Response): Promise<void> => {
    try {
        const data = signinSchema.parse(req.body);

        const user = await prisma.user.findUnique({ where: { email: data.email } });
        if (!user) {
            res.status(400).json({ error: 'Invalid credentials' });
            return;
        }

        // Prevent login for accounts disabled by the admin
        if (!user.isActive) {
            res.status(403).json({ error: 'Account has been deactivated. Contact your admin.' });
            return;
        }

        // Compare the plain-text password against the stored bcrypt hash
        const valid = await bcrypt.compare(data.password, user.password);
        if (!valid) {
            res.status(400).json({ error: 'Invalid credentials' });
            return;
        }

        // Sign a 7-day JWT containing the user's id, email and role
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
                isFirstLogin: user.isFirstLogin, // Frontend redirects to change-password if true
            },
            token,
        });
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
/**
 * Allows ADMIN and MANAGER accounts to self-register.
 * Enforces a hard cap of 2 accounts per role to prevent over-provisioning.
 * Employees are created by an admin via /api/employees, not this endpoint.
 */
const signupSchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['ADMIN', 'MANAGER']),
});

router.post('/signup', async (req: Request, res: Response): Promise<void> => {
    try {
        const data = signupSchema.parse(req.body);

        // Enforce maximum 2 accounts per privileged role
        const count = await prisma.user.count({ where: { role: data.role } });
        if (count >= 2) {
            res.status(400).json({ error: `Maximum 2 ${data.role.toLowerCase()}s are allowed.` });
            return;
        }

        // Prevent duplicate email addresses across all roles
        const existing = await prisma.user.findUnique({ where: { email: data.email } });
        if (existing) { res.status(400).json({ error: 'Email already registered' }); return; }

        const hashedPassword = await bcrypt.hash(data.password, 10);
        const user = await prisma.user.create({
            data: {
                name: data.name,
                email: data.email,
                password: hashedPassword,
                role: data.role,
                isFirstLogin: false, // Admins/managers set their own password on signup
            },
            select: { id: true, name: true, email: true, role: true, isFirstLogin: true, createdAt: true },
        });

        // Return a JWT so the user is immediately logged in after registration
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

// ── POST /api/auth/change-password ────────────────────────────────────────────
/**
 * Allows an authenticated user to change their password.
 * Required for employees on first login (isFirstLogin flag is cleared on success).
 * Verifies the current password before accepting a new one.
 */
router.post('/change-password', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);

        const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
        if (!user) { res.status(404).json({ error: 'User not found' }); return; }

        // Verify the current password to confirm identity before allowing a change
        const valid = await bcrypt.compare(currentPassword, user.password);
        if (!valid) { res.status(400).json({ error: 'Current password is incorrect' }); return; }

        const hashed = await bcrypt.hash(newPassword, 10);
        await prisma.user.update({
            where: { id: user.id },
            data: { password: hashed, isFirstLogin: false }, // Clear first-login flag
        });

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
/**
 * Initiates the password-reset flow.
 * Generates a 6-digit OTP, stores it with a 10-minute expiry, and emails it.
 * Always returns 200 (even when the email is not found) to prevent user enumeration.
 */
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email } = z.object({ email: z.string().email() }).parse(req.body);

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            // Return 200 to prevent attackers from discovering registered emails
            res.json({ message: 'If that email exists, an OTP has been sent.' });
            return;
        }

        // Generate a cryptographically adequate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // Expires in 10 minutes

        // Persist the OTP and its expiry so /verify-otp can validate it
        await prisma.user.update({
            where: { id: user.id },
            data: { otpCode: otp, otpExpiry: expiry },
        });

        // Send OTP via branded HTML email
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

// ── POST /api/auth/verify-otp ─────────────────────────────────────────────────
/**
 * Validates the 6-digit OTP entered by the user.
 * On success, consumes (clears) the OTP to prevent reuse and returns a
 * short-lived (15 min) reset token used by /reset-password.
 */
router.post('/verify-otp', async (req: Request, res: Response): Promise<void> => {
    try {
        const { email, otp } = z.object({
            email: z.string().email(),
            otp: z.string().length(6),
        }).parse(req.body);

        const user = await prisma.user.findUnique({ where: { email } });

        // Reject if OTP is wrong, not set, or has expired
        if (!user || user.otpCode !== otp || !user.otpExpiry || user.otpExpiry < new Date()) {
            res.status(400).json({ error: 'Invalid or expired OTP' });
            return;
        }

        // Issue a short-lived token scoped only to password reset
        const resetToken = jwt.sign(
            { id: user.id, purpose: 'reset' },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '15m' }
        );

        // Consume OTP — prevents the same code being used again
        await prisma.user.update({ where: { id: user.id }, data: { otpCode: null, otpExpiry: null } });

        res.json({ resetToken });
    } catch (error) {
        if (error instanceof z.ZodError) { res.status(400).json({ error: error.errors }); return; }
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────────
/**
 * Completes the password-reset flow.
 * Validates the reset token (must have purpose: 'reset'), then updates the password.
 * The reset token is single-use because it expires after 15 minutes.
 */
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
    try {
        const { resetToken, newPassword } = z.object({
            resetToken: z.string(),
            newPassword: z.string().min(6),
        }).parse(req.body);

        // Verify the reset token and extract the user id
        let payload: any;
        try {
            payload = jwt.verify(resetToken, process.env.JWT_SECRET || 'secret') as any;
        } catch {
            res.status(400).json({ error: 'Invalid or expired reset token' });
            return;
        }

        // Ensure the token was specifically issued for a password reset, not for general auth
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

// ── GET /api/auth/role-availability ──────────────────────────────────────────
/**
 * Returns the number of existing ADMIN and MANAGER accounts and whether
 * new ones can still be registered (max 2 per role).
 * Used by the signup page to disable the role selector when slots are full.
 */
router.get('/role-availability', async (_req: Request, res: Response): Promise<void> => {
    try {
        const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
        const managerCount = await prisma.user.count({ where: { role: 'MANAGER' } });
        res.json({
            ADMIN:    { count: adminCount,   available: adminCount < 2 },
            MANAGER:  { count: managerCount, available: managerCount < 2 },
            EMPLOYEE: { available: true }, // Employees are created by admin, no self-registration
        });
    } catch {
        res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;
