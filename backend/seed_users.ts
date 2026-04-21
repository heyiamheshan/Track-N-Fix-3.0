import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    const hash = await bcrypt.hash('password123', 10);

    await prisma.user.upsert({
        where: { email: 'has@gmail.com' },
        update: { password: hash },
        create: {
            name: 'Has',
            email: 'has@gmail.com',
            password: hash,
            role: 'ADMIN',
            isActive: true,
            isFirstLogin: false
        }
    });

    await prisma.user.upsert({
        where: { email: 'son@gmail.com' },
        update: { password: hash },
        create: {
            name: 'Son',
            email: 'son@gmail.com',
            password: hash,
            role: 'MANAGER',
            isActive: true,
            isFirstLogin: false
        }
    });

    await prisma.user.upsert({
        where: { email: 'Jaya@gmail.com' },
        update: { password: hash },
        create: {
            name: 'Jaya',
            email: 'Jaya@gmail.com',
            password: hash,
            role: 'EMPLOYEE',
            isActive: true,
            isFirstLogin: false
        }
    });

    console.log("Users created with password 'password123'");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
