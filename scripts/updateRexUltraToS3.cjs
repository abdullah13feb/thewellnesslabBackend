const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const S3_HERO_IMAGE = 'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-ULTRA-HERO-IMAGE-1782809846364-jehnkm.png';

const S3_GALLERY_IMAGES = [
  'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-ULTRA-GALLERY-IMAGE-1-1782809868109-odnfyv.png',
  'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-UTRA-GALLERY-IAMGE-2-1782809891995-m2erfk.png',
  'https://thewellnesslab-public-assets.s3.ap-south-1.amazonaws.com/radiant-aura/REX-ULTRA-GALLERY-IMAGE-3-1782809898476-8kl6ne.jpg'
];

async function updateRexUltra() {
  console.log('Finding Product: Rex Ultra...');
  const existing = await prisma.product.findFirst({
    where: { slug: 'rex-ultra' }
  });

  if (!existing) {
    throw new Error('Product with slug "rex-ultra" not found in database!');
  }

  console.log(`Found Rex Ultra (ID: ${existing.id})`);
  console.log('--- Current Cloudinary URLs ---');
  console.log('Hero image:', existing.image);
  console.log('Gallery images:', existing.images);

  console.log('\nUpdating ONLY image and images fields for Rex Ultra to AWS S3...');
  const updated = await prisma.product.update({
    where: { id: existing.id },
    data: {
      image: S3_HERO_IMAGE,
      images: S3_GALLERY_IMAGES
    }
  });

  console.log('\n✅ Successfully updated Rex Ultra in DB!');
  console.log('--- New AWS S3 URLs ---');
  console.log('Hero image:', updated.image);
  console.log('Gallery images:', updated.images);
}

updateRexUltra()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
