const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function createBackup() {
  const backupDir = path.resolve(__dirname, '../backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const blogs = await prisma.blog.findMany();
  const settings = await prisma.setting.findMany();
  const mediaAssets = await prisma.mediaAsset.findMany();

  const backupData = {
    timestamp: new Date().toISOString(),
    blogs,
    settings,
    mediaAssets
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `blogs_settings_media_before_s3_${timestamp}.json`);
  const latestBackupFile = path.join(backupDir, 'blogs_settings_media_latest_backup.json');

  fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf-8');
  fs.writeFileSync(latestBackupFile, JSON.stringify(backupData, null, 2), 'utf-8');

  console.log(`✅ Backup created successfully:`);
  console.log(`   - Blogs: ${blogs.length} records`);
  console.log(`   - Settings: ${settings.length} records`);
  console.log(`   - MediaAssets: ${mediaAssets.length} records`);
  console.log(`   Saved to: ${latestBackupFile}`);
}

createBackup()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
