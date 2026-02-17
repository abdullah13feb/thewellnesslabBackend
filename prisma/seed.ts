import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const products = [
        {
            name: "Thuraya Prestige Panel",
            slug: "thuraya-prestige",
            tagline: "Clinical Wide-Body Station",
            // subtitle: "The largest residential red light therapy panel in the UAE",
            description: "Experience clinical-grade photobiomodulation at home. The Thuraya Prestige delivers 1152 dual-chip LEDs across 9 therapeutic wavelengths, including advanced 480nm Blue Light and 1060nm Fat Targeting technology.",
            price: 19999,
            image: "/src/assets/thuraya-prestige.png",
            category: "Panels",
            stock: 50,
            tag: "Flagship",
            rating: 4.8,
            reviewCount: 87,
            trustBadges: [
                { label: "1-Year Warranty", subLabel: "Full coverage", icon: "Shield" },
                { label: "Free Delivery", subLabel: "UAE wide", icon: "Truck" },
                { label: "Same-Day Dubai", subLabel: "Order before 2PM", icon: "Clock" },
                { label: "Free Installation", subLabel: "Professional setup", icon: "Check" }
            ],
            specs: {
                power: "1549W",
                leds: "1152",
                irradiance: "185mW/cm²",
                coverage: "Wide Body",
                wavelengths: "9 Bands",
                warranty: "1 Year",
                dimensions: "189 × 58 × 6.5 cm",
                voltage: "AC 100-240V",
                lifespan: "50,000+ hours",
                beamAngle: "60°",
                cooling: "Dual Fan System"
            },
            includes: [
                { item: "Thuraya Prestige Panel", description: "1152 LED wide-body panel", value: "AED 17,999", icon: "Box" },
                { item: "Heavy Duty Rotational Stand", description: "360° adjustable mounting system", value: "AED 2,000", icon: "Maximize", highlight: true },
                { item: "Pro Digital Controller", description: "Timer & intensity control", value: "Included", icon: "Settings" },
                { item: "Protective Eyewear", description: "2 pairs of safety goggles", value: "Included", icon: "Glasses" },
                { item: "Power Cable", description: "UAE-compatible power supply", value: "Included", icon: "Cable" },
                { item: "User Manual & Protocol Guide", description: "Comprehensive treatment protocols", value: "Included", icon: "BookOpen" },
                { item: "White Glove Installation", description: "Professional setup in your home", value: "FREE", icon: "Wrench", highlight: true }
            ]
        },
        {
            name: "Altair 1200 Panel",
            slug: "altair-1200",
            tagline: "Systemic Recovery Engine",
            // subtitle: "Professional-grade full-body red light therapy for home use",
            description: "The Altair 1200 delivers 864 dual-chip LEDs across 9 therapeutic wavelengths, including advanced 480nm Blue Light and 1060nm Fat Targeting. Perfect for athletes, biohackers, and wellness enthusiasts seeking clinical-grade results.",
            price: 16999,
            image: "/src/assets/altair-1200.png",
            category: "Panels",
            stock: 100,
            tag: "Best Seller",
            rating: 4.9,
            reviewCount: 127,
            trustBadges: [
                { label: "1-Year Warranty", subLabel: "Full coverage", icon: "Shield" },
                { label: "Free Delivery", subLabel: "UAE wide", icon: "Truck" },
                { label: "Same-Day Dubai", subLabel: "Order before 2PM", icon: "Clock" },
                { label: "Free Installation", subLabel: "Professional setup", icon: "Check" }
            ],
            specs: {
                power: "900W",
                leds: "864",
                irradiance: "161mW/cm²",
                coverage: "Full Body",
                wavelengths: "9 Bands",
                warranty: "1 Year",
                dimensions: "184 × 42 × 6.5 cm",
                voltage: "AC 100-240V",
                lifespan: "50,000+ hours",
                beamAngle: "60°",
                cooling: "Single Fan System"
            },
            includes: [
                { item: "Altair 1200 Panel", description: "864 LED full-body panel", value: "AED 14,999", icon: "Box" },
                { item: "Heavy Duty Rotational Stand", description: "360° adjustable mounting system", value: "AED 2,000", icon: "Maximize", highlight: true },
                { item: "Digital Controller", description: "Timer & intensity control", value: "Included", icon: "Settings" },
                { item: "Protective Eyewear", description: "2 pairs of safety goggles", value: "Included", icon: "Glasses" },
                { item: "Power Cable", description: "UAE-compatible power supply", value: "Included", icon: "Cable" },
                { item: "User Manual & Protocol Guide", description: "Comprehensive treatment protocols", value: "Included", icon: "BookOpen" }
            ]
        }
    ];

    for (const product of products) {
        await prisma.product.upsert({
            where: { slug: product.slug },
            update: product,
            create: product,
        });
        console.log(`Upserted product: ${product.name}`);
    }
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
