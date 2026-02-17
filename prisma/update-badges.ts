import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const badges = [
        { label: "1-Year Warranty", subLabel: "Full coverage", icon: "Shield" },
        { label: "Free Delivery", subLabel: "UAE wide", icon: "Truck" },
        { label: "Same-Day Dubai", subLabel: "Order before 2PM", icon: "Clock" },
        { label: "Free Installation", subLabel: "Professional setup", icon: "Check" }
    ];

    try {
        console.log("Updating Thuraya Prestige...");
        await prisma.product.update({
            where: { slug: 'thuraya-prestige' },
            data: { trustBadges: badges }
        });
        console.log('Updated Thuraya Prestige badges');

        console.log("Updating Altair 1200...");
        await prisma.product.update({
            where: { slug: 'altair-1200' },
            data: { trustBadges: badges }
        });
        console.log('Updated Altair 1200 badges');
    } catch (e) {
        console.error("Error updating badges:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
