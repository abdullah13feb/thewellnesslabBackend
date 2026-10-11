const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function rollback() {
  const backupFile = path.resolve(__dirname, '../backups/remaining_products_latest_backup.json');
  if (!fs.existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }

  const products = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
  for (const p of products) {
    console.log(`Reverting ${p.name} (${p.slug})...`);
    await prisma.product.update({
      where: { id: p.id },
      data: {
        image: p.image,
        images: p.images
      }
    });
  }

  console.log(`✅ Successfully reverted ${products.length} products to Cloudinary URLs!`);
}

rollback()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
