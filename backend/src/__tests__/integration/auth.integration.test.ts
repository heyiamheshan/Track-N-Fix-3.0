/**
 * Integration tests — Auth routes (/api/auth)
 * Mocks Prisma so no database connection is required.
 */

// ── Prisma mock (must be before any import that resolves prisma) ───────────────
jest.mock('../../lib/prisma', () => ({
    __esModule: true,
    default: {
        user: {
            findUnique: jest.fn(),
            create: jest.fn(),
            count: jest.fn(),
            update: jest.fn(),
        },
    },
}));

// ── Nodemailer mock (OTP email tests) ─────────────────────────────────────────
jest.mock('nodemailer', () => ({
    createTransport: () => ({
        sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
    }),
}));

import request from 'supertest';
import bcrypt   from 'bcryptjs';
import jwt      from 'jsonwebtoken';
import app      from '../helpers/testApp';
import prisma   from '../../lib/prisma';

const db = prisma as unknown as {
    user: {
        findUnique: jest.Mock;
        create:     jest.Mock;
        count:      jest.Mock;
        update:     jest.Mock;
    };
};

beforeEach(() => jest.clearAllMocks());

// ── POST /api/auth/signin ─────────────────────────────────────────────────────

describe('POST /api/auth/signin', () => {
    const endpoint = '/api/auth/signin';

    test('200 + JWT token on valid credentials', async () => {
        const hashed = await bcrypt.hash('password123', 10);
        db.user.findUnique.mockResolvedValue({
            id: 'uid-1', name: 'Test Admin', email: 'admin@test.com',
            password: hashed, role: 'ADMIN', isActive: true, isFirstLogin: false,
        });

        const res = await request(app)
            .post(endpoint)
            .send({ email: 'admin@test.com', password: 'password123' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user.role).toBe('ADMIN');
    });

    test('400 on wrong password', async () => {
        const hashed = await bcrypt.hash('realpassword', 10);
        db.user.findUnique.mockResolvedValue({
            id: 'uid-1', email: 'admin@test.com',
            password: hashed, role: 'ADMIN', isActive: true,
        });

        const res = await request(app)
            .post(endpoint)
            .send({ email: 'admin@test.com', password: 'wrongpassword' });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error', 'Invalid credentials');
    });

    test('400 when user does not exist', async () => {
        db.user.findUnique.mockResolvedValue(null);

        const res = await request(app)
            .post(endpoint)
            .send({ email: 'nobody@test.com', password: 'pass' });

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error', 'Invalid credentials');
    });

    test('403 when account is deactivated (isActive = false)', async () => {
        const hashed = await bcrypt.hash('pass', 10);
        db.user.findUnique.mockResolvedValue({
            id: 'uid-2', email: 'fired@test.com',
            password: hashed, role: 'EMPLOYEE', isActive: false,
        });

        const res = await request(app)
            .post(endpoint)
            .send({ email: 'fired@test.com', password: 'pass' });

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/deactivated/i);
    });

    test('400 on malformed request body (missing email)', async () => {
        const res = await request(app)
            .post(endpoint)
            .send({ password: 'pass' });

        expect(res.status).toBe(400);
    });
});

// ── POST /api/auth/signup ─────────────────────────────────────────────────────

describe('POST /api/auth/signup', () => {
    const endpoint = '/api/auth/signup';
    const validPayload = {
        name: 'New Admin',
        email: 'newadmin@test.com',
        password: 'secure123',
        role: 'ADMIN',
    };

    test('201 + token when first admin registers', async () => {
        db.user.count.mockResolvedValue(0);          // 0 existing admins
        db.user.findUnique.mockResolvedValue(null);  // email not taken
        db.user.create.mockResolvedValue({
            id: 'uid-new', name: 'New Admin', email: 'newadmin@test.com',
            role: 'ADMIN', isFirstLogin: false, createdAt: new Date(),
        });

        const res = await request(app).post(endpoint).send(validPayload);

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user.role).toBe('ADMIN');
    });

    test('400 when 3rd Admin account is attempted (role limit = 2)', async () => {
        db.user.count.mockResolvedValue(2); // already 2 admins

        const res = await request(app).post(endpoint).send(validPayload);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/maximum 2/i);
    });

    test('400 when email is already registered', async () => {
        db.user.count.mockResolvedValue(1);
        db.user.findUnique.mockResolvedValue({ id: 'existing' }); // email exists

        const res = await request(app).post(endpoint).send(validPayload);

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already registered/i);
    });

    test('400 when role is EMPLOYEE (self-registration not allowed)', async () => {
        const res = await request(app)
            .post(endpoint)
            .send({ ...validPayload, role: 'EMPLOYEE' });

        expect(res.status).toBe(400);
    });
});

// ── Protected routes: no token / bad token ────────────────────────────────────

describe('Auth middleware', () => {
    test('401 when Authorization header is absent', async () => {
        const res = await request(app).post('/api/auth/change-password').send({});
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error', 'No token provided');
    });

    test('401 when token is invalid', async () => {
        const res = await request(app)
            .post('/api/auth/change-password')
            .set('Authorization', 'Bearer this.is.garbage')
            .send({});
        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error', 'Invalid token');
    });
});

// ── POST /api/auth/change-password ───────────────────────────────────────────

describe('POST /api/auth/change-password', () => {
    test('200 on successful password change', async () => {
        const hashed = await bcrypt.hash('oldpass', 10);
        const token  = jwt.sign(
            { id: 'uid-1', email: 'e@test.com', role: 'EMPLOYEE' },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '1h' },
        );

        db.user.findUnique.mockResolvedValue({
            id: 'uid-1', password: hashed, role: 'EMPLOYEE',
        });
        db.user.update.mockResolvedValue({ id: 'uid-1' });

        const res = await request(app)
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: 'oldpass', newPassword: 'newpass123' });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/changed/i);
    });

    test('400 when current password is wrong', async () => {
        const hashed = await bcrypt.hash('correctpass', 10);
        const token  = jwt.sign(
            { id: 'uid-1', email: 'e@test.com', role: 'EMPLOYEE' },
            process.env.JWT_SECRET || 'secret',
            { expiresIn: '1h' },
        );

        db.user.findUnique.mockResolvedValue({
            id: 'uid-1', password: hashed, role: 'EMPLOYEE',
        });

        const res = await request(app)
            .post('/api/auth/change-password')
            .set('Authorization', `Bearer ${token}`)
            .send({ currentPassword: 'wrongpass', newPassword: 'newpass123' });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/incorrect/i);
    });
});
