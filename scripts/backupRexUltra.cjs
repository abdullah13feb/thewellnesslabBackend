const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createBackup() {
  const backupDir = path.resolve(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Backup Rex Ultra specifically
  const rexUltra = await prisma.product.findFirst({
    where: { slug: 'rex-ultra' }
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rexUltraBackupPath = path.join(backupDir, `rex_ultra_before_s3_update_${timestamp}.json`);
  const rexUltraLatestBackupPath = path.join(backupDir, 'rex_ultra_latest_backup.json');

  fs.writeFileSync(rexUltraBackupPath, JSON.stringify(rexUltra, null, 2), 'utf-8');
  fs.writeFileSync(rexUltraLatestBackupPath, JSON.stringify(rexUltra, null, 2), 'utf-8');

  // Also backup all products for 100% peace of mind
  const allProducts = await prisma.product.findMany();
  const allProductsBackupPath = path.join(backupDir, `all_products_before_update_${timestamp}.json`);
  fs.writeFileSync(allProductsBackupPath, JSON.stringify(allProducts, null, 2), 'utf-8');

  console.log(`✅ Backup created successfully:`);
  console.log(`   - Rex Ultra backup: ${rexUltraBackupPath}`);
  console.log(`   - Latest pointer: ${rexUltraLatestBackupPath}`);
  console.log(`   - All products backup: ${allProductsBackupPath}`);
}

createBackup()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
