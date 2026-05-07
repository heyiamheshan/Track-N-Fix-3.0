import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    const hash = await bcrypt.hash('demo1234', 10);

    // ── Demo Users ─────────────────────────────────────────────────────────────
    const admin = await prisma.user.upsert({
        where: { email: 'admin@demo.com' },
        update: { password: hash, isFirstLogin: false },
        create: { name: 'Alex Admin', email: 'admin@demo.com', password: hash, role: 'ADMIN', isActive: true, isFirstLogin: false },
    });

    const manager = await prisma.user.upsert({
        where: { email: 'manager@demo.com' },
        update: { password: hash, isFirstLogin: false },
        create: { name: 'Mike Manager', email: 'manager@demo.com', password: hash, role: 'MANAGER', isActive: true, isFirstLogin: false },
    });

    const employee = await prisma.user.upsert({
        where: { email: 'employee@demo.com' },
        update: { password: hash, isFirstLogin: false },
        create: { name: 'Eve Employee', email: 'employee@demo.com', password: hash, role: 'EMPLOYEE', isActive: true, isFirstLogin: false },
    });

    // ── Vehicles ───────────────────────────────────────────────────────────────
    const v1 = await prisma.vehicle.upsert({
        where: { vehicleNumber: 'CAB-1234' },
        update: {},
        create: { vehicleNumber: 'CAB-1234', ownerName: 'Asanka Perera', telephone: '0712345678', whatsappNumber: '0712345678', vehicleType: 'CAR', color: 'Silver', address: '12/A, Galle Road, Colombo 3' },
    });
    const v2 = await prisma.vehicle.upsert({
        where: { vehicleNumber: 'WP-KA-5678' },
        update: {},
        create: { vehicleNumber: 'WP-KA-5678', ownerName: 'Saman Silva', telephone: '0723456789', whatsappNumber: '0723456789', vehicleType: 'CAR', color: 'White', address: '45, Kandy Road, Kelaniya' },
    });
    const v3 = await prisma.vehicle.upsert({
        where: { vehicleNumber: 'NC-9012' },
        update: {},
        create: { vehicleNumber: 'NC-9012', ownerName: 'Dilshan Fernando', telephone: '0734567890', whatsappNumber: '0734567890', vehicleType: 'CAR', color: 'Blue', address: '78, Negombo Road, Wattala' },
    });
    const v4 = await prisma.vehicle.upsert({
        where: { vehicleNumber: 'WP-CB-3456' },
        update: {},
        create: { vehicleNumber: 'WP-CB-3456', ownerName: 'Kumari Jayawardena', telephone: '0745678901', whatsappNumber: '0745678901', vehicleType: 'CAR', color: 'Red', address: '23, Baseline Road, Colombo 8' },
    });
    const v5 = await prisma.vehicle.upsert({
        where: { vehicleNumber: 'SP-7890' },
        update: {},
        create: { vehicleNumber: 'SP-7890', ownerName: 'Nimal Bandara', telephone: '0756789012', whatsappNumber: '0756789012', vehicleType: 'CAR', color: 'Black', address: '67, High Level Road, Maharagama' },
    });

    // ── Spare Parts ────────────────────────────────────────────────────────────
    const brakePart = await prisma.sparePart.upsert({
        where: { serialNumber: 'DEMO-BRAKP-002' },
        update: {},
        create: { name: 'Brake Pads Set', serialNumber: 'DEMO-BRAKP-002', description: 'Front disc brake pads', boughtPrice: 2200, sellingPrice: 3500, quantity: 12, lowStockThreshold: 5, supplierName: 'Parts World', purchaseDate: new Date('2025-02-10') },
    });
    const oilFilter = await prisma.sparePart.upsert({
        where: { serialNumber: 'DEMO-OILF-003' },
        update: {},
        create: { name: 'Engine Oil Filter', serialNumber: 'DEMO-OILF-003', description: 'Oil filter for petrol engines', boughtPrice: 350, sellingPrice: 650, quantity: 25, lowStockThreshold: 10, supplierName: 'SL Auto Parts', purchaseDate: new Date('2025-03-05') },
    });
    const sparkPlugs = await prisma.sparePart.upsert({
        where: { serialNumber: 'DEMO-SPRK-005' },
        update: {},
        create: { name: 'Spark Plugs (Set of 4)', serialNumber: 'DEMO-SPRK-005', description: 'NGK iridium spark plugs', boughtPrice: 1800, sellingPrice: 2800, quantity: 15, lowStockThreshold: 6, supplierName: 'NGK Lanka', purchaseDate: new Date('2025-04-01') },
    });
    await prisma.sparePart.upsert({
        where: { serialNumber: 'DEMO-BATT-001' },
        update: {},
        create: { name: 'Car Battery 12V', serialNumber: 'DEMO-BATT-001', description: 'Maintenance-free lead acid battery', boughtPrice: 8500, sellingPrice: 12000, quantity: 8, lowStockThreshold: 3, supplierName: 'Daewoo Lanka', purchaseDate: new Date('2025-01-15') },
    });
    await prisma.sparePart.upsert({
        where: { serialNumber: 'DEMO-ALTB-004' },
        update: {},
        // Low stock to trigger the low-stock alert in the manager dashboard
        create: { name: 'Alternator Belt', serialNumber: 'DEMO-ALTB-004', description: 'V-belt for alternator drive', boughtPrice: 750, sellingPrice: 1200, quantity: 2, lowStockThreshold: 5, supplierName: 'SL Auto Parts', purchaseDate: new Date('2025-03-20') },
    });

    // ── Jobs ───────────────────────────────────────────────────────────────────
    // Use vehicleId lookup so array order doesn't matter on re-runs.
    const findOrCreateJob = async (vehicleId: string, status: string, jobType: string, notes: string, insuranceCompany?: string, createdAt?: Date) => {
        const existing = await prisma.job.findFirst({ where: { vehicleId, employeeId: employee.id } });
        if (existing) return existing;
        return prisma.job.create({
            data: { vehicleId, employeeId: employee.id, jobType: jobType as any, status: status as any, notes, insuranceCompany, createdAt: createdAt ?? new Date() },
        });
    };

    const completedJob = await findOrCreateJob(v1.id, 'COMPLETED', 'SERVICE', 'Full service completed. Oil changed, filters replaced, brake inspection done.', undefined, new Date('2025-04-10'));
    const finalizedJob = await findOrCreateJob(v2.id, 'FINALIZED', 'REPAIR', 'Engine knocking noise repaired. Spark plugs and timing belt replaced.', undefined, new Date('2025-04-20'));
    const quotedJob    = await findOrCreateJob(v3.id, 'QUOTED', 'ACCIDENT_RECOVERY', 'Front bumper damage, headlights broken, hood dented.', 'Sri Lanka Insurance', new Date('2025-05-01'));
    await findOrCreateJob(v4.id, 'REVIEWED', 'SERVICE', 'Routine 10,000 km service. Air filter, oil filter, and oil change needed.', undefined, new Date('2025-05-03'));
    await findOrCreateJob(v5.id, 'SUBMITTED', 'REPAIR', 'Electrical fault — AC not working and dashboard lights flickering.', undefined, new Date('2025-05-05'));

    // ── Quotations ─────────────────────────────────────────────────────────────
    const existingQuotations = await prisma.quotation.count({ where: { adminId: admin.id } });
    if (existingQuotations === 0) {
        await prisma.quotation.create({
            data: {
                jobId: completedJob.id, vehicleId: v1.id, adminId: admin.id, managerId: manager.id,
                vehicleNumber: 'CAB-1234', ownerName: 'Asanka Perera', telephone: '0712345678', vehicleType: 'CAR', color: 'Silver',
                jobDetails: 'Full vehicle service: oil change, filter replacement, brake inspection, fluid top-up.',
                totalAmount: 15800, status: 'FINALIZED', notificationSent: true, notifiedAt: new Date('2025-04-12'),
                createdAt: new Date('2025-04-11'),
                items: {
                    create: [
                        { description: 'Engine Oil Change (5L)', partReplaced: 'Engine Oil', price: 3500, laborCost: 500, quantity: 1 },
                        { description: 'Oil Filter Replacement', partReplaced: 'Oil Filter', price: 650, laborCost: 200, quantity: 1, sparePartId: oilFilter.id },
                        { description: 'Brake Pad Replacement (Front)', partReplaced: 'Brake Pads', price: 3500, laborCost: 800, quantity: 2, sparePartId: brakePart.id },
                        { description: 'Air Filter Replacement', price: 1200, laborCost: 200, quantity: 1 },
                        { description: 'General Service Labor', price: 0, laborCost: 5250, quantity: 1 },
                    ],
                },
            },
        });

        await prisma.quotation.create({
            data: {
                jobId: finalizedJob.id, vehicleId: v2.id, adminId: admin.id, managerId: manager.id,
                vehicleNumber: 'WP-KA-5678', ownerName: 'Saman Silva', telephone: '0723456789', vehicleType: 'CAR', color: 'White',
                jobDetails: 'Engine knocking repair: spark plug replacement and timing belt replacement.',
                totalAmount: 18500, status: 'FINALIZED', createdAt: new Date('2025-04-21'),
                items: {
                    create: [
                        { description: 'Spark Plugs Replacement (Set of 4)', partReplaced: 'Spark Plugs', price: 2800, laborCost: 600, quantity: 1, sparePartId: sparkPlugs.id },
                        { description: 'Timing Belt Replacement', price: 4500, laborCost: 2000, quantity: 1 },
                        { description: 'Engine Diagnostic & Report', price: 0, laborCost: 1500, quantity: 1 },
                        { description: 'Engine Repair Labor', price: 0, laborCost: 7100, quantity: 1 },
                    ],
                },
            },
        });

        await prisma.quotation.create({
            data: {
                jobId: quotedJob.id, vehicleId: v3.id, adminId: admin.id,
                vehicleNumber: 'NC-9012', ownerName: 'Dilshan Fernando', telephone: '0734567890', vehicleType: 'CAR', color: 'Blue',
                insuranceCompany: 'Sri Lanka Insurance',
                jobDetails: 'Accident recovery: front bumper, headlights, hood repair and repainting.',
                totalAmount: 85000, status: 'SENT_TO_MANAGER', createdAt: new Date('2025-05-02'),
                items: {
                    create: [
                        { description: 'Front Bumper Replacement', partReplaced: 'Front Bumper', price: 25000, laborCost: 3000, quantity: 1 },
                        { description: 'Headlight Assembly (Left)', partReplaced: 'Headlight', price: 12000, laborCost: 800, quantity: 1 },
                        { description: 'Headlight Assembly (Right)', partReplaced: 'Headlight', price: 12000, laborCost: 800, quantity: 1 },
                        { description: 'Hood Panel Repair & Repaint', price: 15000, laborCost: 8000, quantity: 1 },
                        { description: 'Body Work Labor', price: 0, laborCost: 8400, quantity: 1 },
                    ],
                },
            },
        });
    }

    // ── Attendance (14 working days for demo employee) ─────────────────────────
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 1; i <= 21; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const dow = date.getDay();
        if (dow === 0 || dow === 6) continue; // skip weekends

        const checkIn = new Date(date); checkIn.setHours(8, 30, 0, 0);
        const checkOut = new Date(date); checkOut.setHours(18, 30, 0, 0);

        // Day 8 simulates overtime
        const isOvertime = i === 8;
        const otStart = isOvertime ? new Date(date) : undefined;
        const otEnd   = isOvertime ? new Date(date) : undefined;
        if (otStart) otStart.setHours(18, 30, 0, 0);
        if (otEnd)   otEnd.setHours(21, 0, 0, 0);

        await prisma.attendance.upsert({
            where: { employeeId_date: { employeeId: employee.id, date } },
            update: {},
            create: {
                employeeId: employee.id, date,
                checkInTime: checkIn,
                checkOutTime: isOvertime ? otEnd : checkOut,
                status: isOvertime ? 'OVERTIME' : 'PRESENT',
                overtimeStart: otStart ?? null,
                overtimeEnd: otEnd ?? null,
            },
        });
    }

    // ── Notifications ──────────────────────────────────────────────────────────
    const notifCount = await prisma.notification.count({ where: { userId: { in: [admin.id, manager.id] } } });
    if (notifCount === 0) {
        await prisma.notification.createMany({
            data: [
                { fromRole: 'EMPLOYEE', toRole: 'ADMIN', message: 'New job submitted for NC-9012. Accident recovery needed urgently.', vehicleNumber: 'NC-9012', userId: admin.id, isRead: false },
                { fromRole: 'EMPLOYEE', toRole: 'ADMIN', message: 'New job submitted for SP-7890. Electrical fault diagnosis required.', vehicleNumber: 'SP-7890', userId: admin.id, isRead: false },
                { fromRole: 'ADMIN', toRole: 'MANAGER', message: 'Quotation for WP-KA-5678 is ready for your review and finalisation.', vehicleNumber: 'WP-KA-5678', userId: manager.id, isRead: true },
                { fromRole: 'MANAGER', toRole: 'ADMIN', message: 'Quotation for CAB-1234 has been finalised. Ready to notify customer.', vehicleNumber: 'CAB-1234', userId: admin.id, isRead: true },
                { fromRole: 'ADMIN', toRole: 'MANAGER', message: 'Accident recovery quotation for NC-9012 sent for your review.', vehicleNumber: 'NC-9012', userId: manager.id, isRead: false },
            ],
        });
    }

    console.log('\n✅ Demo data seeded successfully!\n');
    console.log('Demo login credentials (password: demo1234):');
    console.log('  Admin    →  admin@demo.com');
    console.log('  Manager  →  manager@demo.com');
    console.log('  Employee →  employee@demo.com\n');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
