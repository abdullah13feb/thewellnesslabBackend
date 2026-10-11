const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function rollback() {
  const backupFile = path.resolve(__dirname, '../backups/blogs_settings_media_latest_backup.json');
  if (!fs.existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }

  const { blogs, settings, mediaAssets } = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));

  console.log(`Reverting ${blogs.length} blogs...`);
  for (const b of blogs) {
    await prisma.blog.update({
      where: { id: b.id },
      data: {
        image: b.image,
        content: b.content
      }
    });
  }

  console.log(`Reverting ${settings.length} settings...`);
  for (const s of settings) {
    await prisma.setting.update({
      where: { id: s.id },
      data: {
        value: s.value
      }
    });
  }

  console.log(`Reverting ${mediaAssets.length} media assets...`);
  for (const m of mediaAssets) {
    await prisma.mediaAsset.update({
      where: { id: m.id },
      data: {
        url: m.url
      }
    });
  }

  console.log(`✅ Successfully reverted Blogs, Settings, and MediaAssets to backup state!`);
}

rollback()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
