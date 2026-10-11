const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createBackup() {
  const backupDir = path.resolve(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Fetch Rex Pro, Rex Core, Rex Prestige
  const products = await prisma.product.findMany({
    where: {
      slug: {
        in: ['rex-pro', 'rex-core', 'rex-prestige']
      }
    }
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `remaining_products_before_s3_${timestamp}.json`);
  const latestBackupFile = path.join(backupDir, 'remaining_products_latest_backup.json');

  fs.writeFileSync(backupFile, JSON.stringify(products, null, 2), 'utf-8');
  fs.writeFileSync(latestBackupFile, JSON.stringify(products, null, 2), 'utf-8');

  console.log(`✅ Backup created for ${products.length} products:`);
  products.forEach(p => console.log(`   - ${p.name} (${p.slug})`));
  console.log(`   Saved to: ${latestBackupFile}`);
}

createBackup()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
