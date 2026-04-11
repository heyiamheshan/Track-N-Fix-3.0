import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    const q = await prisma.quotation.findFirst({
        where: { vehicleNumber: 'CC-678' }
    });
    console.log("CC-678 Quotation Database state:");
    console.log(JSON.stringify(q, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
