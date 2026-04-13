import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
async function main() {
    const hash = await bcrypt.hash('password123', 10);
    await prisma.user.update({ where: { email: 'has@gmail.com' }, data: { password: hash } });
    await prisma.user.update({ where: { email: 'son@gmail.com' }, data: { password: hash } });
    await prisma.user.update({ where: { email: 'Jaya@gmail.com' }, data: { password: hash } });
    console.log("passwords updated to password123");
}
main().catch(console.error).finally(() => prisma.$disconnect());
