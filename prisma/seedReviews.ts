import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const initialReviews = [
  {
    name: 'Shamsa',
    rating: 5,
    comment:
      'Fifteen minutes in the morning and I feel it all day. The REX CORE has become part of my routine I do not skip.',
    status: 'approved',
    productName: 'REX CORE',
    verified: true,
  },
  {
    name: 'Nitin',
    rating: 5,
    comment:
      'Recovery after training used to take days. With red light at home it is noticeably quicker, and setup was effortless.',
    status: 'approved',
    productName: 'REX CORE',
    verified: true,
  },
  {
    name: 'M Harib',
    rating: 5,
    comment:
      'The PRESTIGE is a statement piece and it delivers. Full body coverage, premium build, and the support has been first class.',
    status: 'approved',
    productName: 'REX PRESTIGE',
    verified: true,
  },
  {
    name: 'Nahida',
    rating: 5,
    comment:
      'Compact, powerful and easy to use every day. The REX PRO fits my space perfectly and my skin and sleep have both improved.',
    status: 'approved',
    productName: 'REX PRO',
    verified: true,
  },
];

async function main() {
  console.log('Seeding initial approved reviews into Review table...');
  for (const reviewData of initialReviews) {
    const existing = await (prisma as any).review.findFirst({
      where: {
        name: reviewData.name,
        comment: reviewData.comment,
      },
    });

    if (!existing) {
      await (prisma as any).review.create({
        data: reviewData,
      });
      console.log(`Created review for ${reviewData.name}`);
    } else {
      console.log(`Review for ${reviewData.name} already exists`);
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
