const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function rollback() {
  const backupFile = path.resolve(__dirname, '../backups/rex_ultra_latest_backup.json');
  if (!fs.existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }

  const backupData = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
  console.log(`Reverting Rex Ultra (${backupData.id}) back to Cloudinary URLs:`);
  console.log(`  image: ${backupData.image}`);
  console.log(`  images:`, backupData.images);

  const updated = await prisma.product.update({
    where: { id: backupData.id },
    data: {
      image: backupData.image,
      images: backupData.images
    }
  });

  console.log('✅ Reverted Rex Ultra to backup state successfully!');
}

rollback()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
