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

    const blogs = [
        {
            title: "The Biological Mechanisms of Photobiomodulation: A Clinical Analysis",
            slug: "biological-mechanisms-photobiomodulation",
            category: "Clinical Analysis",
            author: "Dr. Elena Rostova",
            excerpt: "An in-depth exploration of how specific wavelengths of light stimulate mitochondrial cytochrome c oxidase to enhance ATP production and cellular repair.",
            content: `
                <h3>Understanding Cellular Energy Dynamics</h3>
                <p>At the core of red light therapy's efficacy is its interaction with the mitochondria, often referred to as the powerhouse of the cell. Specifically, red (630-660nm) and near-infrared (810-850nm) wavelengths are absorbed by a photoacceptor called <strong>cytochrome c oxidase (CCO)</strong>.</p>
                <p>When CCO absorbs this light energy, it dissociates nitric oxide (NO) which can competitively inhibit oxygen consumption. This dissociation allows oxygen to resume its role in the respiratory chain, leading to a significant increase in the production of <strong>Adenosine Triphosphate (ATP)</strong>.</p>
                
                <h3>Key Metabolic Benefits</h3>
                <ul>
                    <li><strong>Enhanced ATP Production:</strong> Increased cellular energy allows for faster repair of tissues and improved cellular function.</li>
                    <li><strong>Reduced Oxidative Stress:</strong> The process effectively modulates reactive oxygen species (ROS), shifting the cellular state from pro-oxidant to antioxidant.</li>
                    <li><strong>Anti-Inflammatory Response:</strong> By modulating nuclear factor kappa B (NF-kB), red light therapy significantly reduces chronic inflammation markers.</li>
                </ul>

                <h3>Clinical Applications</h3>
                <p>Recent studies suggest that this mechanism is not limited to skin surface interaction. Near-infrared light penetrates deeper into tissues, reaching muscles, tendons, and even the brain, offering systemic benefits ranging from accelerated wound healing to improved cognitive function in neurodegenerative conditions.</p>
                <img src="https://images.unsplash.com/photo-1576091160550-217358c7db81?q=80&w=2070&auto=format&fit=crop" alt="Cellular visualization" class="w-full rounded-lg my-6 shadow-md" />
                <p>As research continues, the precise dosing (biphasic dose response) becomes critical. The Wellness Lab's devices are calibrated to deliver optimal irradiance within the therapeutic window, ensuring maximum efficacy without cellular inhibition.</p>
            `,
            image: "https://images.unsplash.com/photo-1579684385180-1ea55f61d2d2?q=80&w=2070&auto=format&fit=crop",
            readTime: "8 min read",
            featured: true,
            authorId: "seed-admin"
        },
        {
            title: "Optimizing Athletic Recovery: The 9-Wavelength Protocol",
            slug: "optimizing-athletic-recovery-protocol",
            category: "Health & Wellness",
            author: "Marcus Thorne, CSCS",
            excerpt: "How elite athletes are utilizing multi-spectrum light therapy to reduce DOMS, clear lactate, and accelerate muscle hypertrophy.",
            content: `
                <p>Recovery is the bottleneck of high performance. Elite athletes are turning to photobiomodulation (PBM) not just for injury rehab, but as a staple in their daily training regimen. The key lies in the <strong>9-wavelength spectrum</strong>, which targets different tissue depths simultaneously.</p>
                
                <h3>The Post-Workout Window</h3>
                <p>Applying red light therapy immediately after training (within 0-3 hours) has shown to:</p>
                <ul>
                    <li>Significantly reduce <strong>Delayed Onset Muscle Soreness (DOMS)</strong> by up to 50%.</li>
                    <li>Accelerate the clearance of blood lactate and creatine kinase.</li>
                    <li>Promote muscle hypertrophy by stimulating satellite cell activity.</li>
                </ul>

                <h3>Strategic Wavelength Usage</h3>
                <p>While 660nm targets the superficial fascia and skin, the longer wavelengths like <strong>810nm, 830nm, and 850nm</strong> penetrate deep into the muscle belly. This deep tissue stimulation increases blood flow and oxygenation (microcirculation), which is crucial for flushing out metabolic waste products.</p>
                
                <img src="https://images.unsplash.com/photo-1517836357463-d25dfeac3438?q=80&w=2070&auto=format&fit=crop" alt="Athlete recovery" class="w-full rounded-lg my-6 shadow-md" />

                <h3>Sample Protocol</h3>
                <p>For generalized recovery, we recommend a 10-minute session at a distance of 6-12 inches, targeting the major muscle groups used during the workout. Consistency is key—daily sessions yield cumulative benefits that sporadic use cannot match.</p>
            `,
            image: "https://images.unsplash.com/photo-1599058945522-28d584b6f0ff?q=80&w=2069&auto=format&fit=crop",
            readTime: "6 min read",
            featured: true,
            authorId: "seed-admin"
        },
        {
            title: "Circadian Rhythm Entrainment: Light as Medicine",
            slug: "circadian-rhythm-entrainment",
            category: "Lifestyle",
            author: "Dr. Sarah Mitchell",
            excerpt: "Regulating your internal clock with precision light therapy to combat insomnia, improve sleep quality, and boost morning alertness.",
            content: `
                <p>Light is the primary zeitgeber (time-giver) for the human biological clock. In our modern world, we are bombarded by junk artificial light—specifically blue light—at all the wrong times. This disrupts cortisol and melatonin rhythms, leading to chronic sleep deprivation.</p>
                
                <h3>Morning vs. Evening Protocols</h3>
                <p><strong>Morning:</strong> High-intensity bright light (mimicking solar noon) signals the suprachiasmatic nucleus (SCN) to suppress melatonin and spike cortisol, waking you up.</p>
                <p><strong>Evening:</strong> This is where red light therapy shines. Unlike blue light, red wavelengths (600nm+) do <strong>not</strong> suppress melatonin. Using a red light panel in the evening provides soothing illumination that helps transition the nervous system into a parasympathetic (rest and digest) state.</p>
                
                <h3>Benefits of Evening Red Light</h3>
                <ul>
                    <li>Facilitates faster sleep onset (sleep latency).</li>
                    <li>Increases deep wave (NREM) sleep duration.</li>
                    <li>Reduces nighttime cortisol levels.</li>
                </ul>
                <p>Integrating a 15-minute red light session into your bedtime routine can act as a powerful anchor for your circadian rhythm, protecting your sleep hygiene in a digital age.</p>
            `,
            image: "https://images.unsplash.com/photo-1515890435782-59a5bb6e0e27?q=80&w=2070&auto=format&fit=crop",
            readTime: "5 min read",
            featured: false,
            authorId: "seed-admin"
        },
        {
            title: "Skin Rejuvenation: Beyond the Surface",
            slug: "skin-rejuvenation-collagen",
            category: "Beauty & Aesthetics",
            author: "The Wellness Lab",
            excerpt: "Analyzing the collision of collagen synthesis and red light therapy for anti-aging, scar reduction, and skin tone improvement.",
            content: `
                <p>Collagen is the scaffolding of our skin. As we age, collagen production declines, leading to wrinkles and sagging. Red light therapy (specifically 630nm and 660nm) has been clinically proven to stimulate fibroblasts—the cells responsible for producing collagen fibers.</p>
                
                <h3>The 'Glow' Effect</h3>
                <p>Users often report an immediate "glow" after sessions. This is attributed to increased microcirculation, bringing oxygen and nutrients to the skin surface while flushing out toxins. Over time, this results in:</p>
                <ul>
                    <li>Reduction in fine lines and wrinkles.</li>
                    <li>Smoother skin texture and reduced pore size.</li>
                    <li>Fading of acne scars and hyperpigmentation.</li>
                </ul>
                
                <h3>Clinical Evidence</h3>
                <p>A 2014 study confirmed that subjects treated with red light therapy experienced significantly improved skin complexion and skin feeling, creating a high patient satisfaction rate. It's a non-invasive, chemical-free alternative to harsh peels and lasers.</p>
                <img src="https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?q=80&w=2070&auto=format&fit=crop" alt="Skin care" class="w-full rounded-lg my-6 shadow-md" />
            `,
            image: "https://images.unsplash.com/photo-1598440947619-2c35fc9af908?q=80&w=2070&auto=format&fit=crop",
            readTime: "4 min read",
            featured: false,
            authorId: "seed-admin"
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

    for (const blog of blogs) {
        await prisma.blog.upsert({
            where: { slug: blog.slug },
            update: blog,
            create: blog,
        });
        console.log(`Upserted blog: ${blog.title}`);
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
