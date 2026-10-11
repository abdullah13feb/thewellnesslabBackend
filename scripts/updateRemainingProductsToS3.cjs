const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const PRODUCT_UPDATES = {
  'rex-pro': {
    name: 'Rex Pro',
    image: 'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRO-HERO-IMAGE-1782810071508-qbqv98.png',
    images: [
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRO-GALLERY-IMAEG-1-1782810086752-91oi7e.png',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRO-GALLERY-IMAGE-2-1782810088234-kv2hhu.png',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRO-GALLERY-IMAGE-3-1782810089719-oep1hj.png',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRO-GALLERY-IMAGE-4-1782810091200-8xlfi8.png'
    ]
  },
  'rex-core': {
    name: 'Rex Core',
    image: 'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/RexCore-hero-Image-1782809939303-bb8ytf.jpg',
    images: [
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-CORE-GALLERY-IMAGE-1-1782809969932-jiiwcn.jpg',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-CORE-GALLERY-IMAGE-3-1782809970676-188vav.jpg',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-CORE-GALLERY-IMAGE-4-1782809970860-xqgf23.png',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-CORE-GALLERY-IMAGE-5-1782809972338-lf75vm.jpg',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/RexCore-Gallery-Image-2-1782809973148-28d5kl.png'
    ]
  },
  'rex-prestige': {
    name: 'Rex Prestige',
    image: 'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRESTIGE-HERO-IMAGE-1782810012065-i7a2og.png',
    images: [
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRESTIGE-GALLERY-IMAGE-1-1782810023686-xgytlq.png',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRESTIGE-GALLERY-IMAGE-2-1782810025168-q9ssg0.jpg',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRESTIGE-GALLERY-IMAGE-3-1782810043173-5ws8po.jpg',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRESTIGE-GALLERY-IMAGE-3-1782810043175-qrqots.png',
      'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-PRESTIGE-GALLERY-IMAGE-4-1782810043917-oybj1j.jpg'
    ]
  }
};

async function updateRemainingProducts() {
  console.log('Starting S3 image URL update for Rex Pro, Rex Core, and Rex Prestige...\n');

  for (const [slug, data] of Object.entries(PRODUCT_UPDATES)) {
    const existing = await prisma.product.findFirst({ where: { slug } });
    if (!existing) {
      console.error(`❌ Product with slug "${slug}" not found in DB!`);
      continue;
    }

    console.log(`Updating ${data.name} (${existing.id})...`);
    const updated = await prisma.product.update({
      where: { id: existing.id },
      data: {
        image: data.image,
        images: data.images
      }
    });

    console.log(`✅ ${data.name} updated successfully!`);
    console.log(`   Hero: ${updated.image}`);
    console.log(`   Gallery count: ${updated.images.length}\n`);
  }

  console.log('🎉 All remaining products successfully updated to AWS S3!');
}

updateRemainingProducts()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
