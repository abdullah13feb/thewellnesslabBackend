const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Load the 1:1 mapping
const mapping = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../cloudinary_to_s3_mapping.json'), 'utf-8'));

const mapByExactUrl = new Map();
const mapByPublicId = new Map();
const mapByFilename = new Map();

for (const item of mapping) {
  if (item.secure_url) mapByExactUrl.set(item.secure_url, item.s3_url);
  if (item.public_id) {
    mapByPublicId.set(item.public_id, item.s3_url);
    const idNoFolder = item.public_id.split('/').pop();
    if (idNoFolder) mapByFilename.set(idNoFolder, item.s3_url);
  }
}

function findS3Url(cloudUrl) {
  if (!cloudUrl) return null;
  if (mapByExactUrl.has(cloudUrl)) return mapByExactUrl.get(cloudUrl);

  const match = cloudUrl.match(/\/upload\/(?:[^\/]+\/)*(?:v\d+\/)?([^\.\?\#]+)(?:\.([a-zA-Z0-9]+))?/);
  if (match) {
    const publicId = match[1];
    if (mapByPublicId.has(publicId)) return mapByPublicId.get(publicId);
    const filenameOnly = publicId.split('/').pop();
    if (filenameOnly && mapByFilename.has(filenameOnly)) return mapByFilename.get(filenameOnly);
  }

  for (const item of mapping) {
    const rawId = item.public_id.split('/').pop();
    if (rawId && cloudUrl.includes(rawId)) {
      return item.s3_url;
    }
  }
  return null;
}

const CLOUDINARY_REGEX = /https?:\/\/res\.cloudinary\.com\/[^\s\"\'\)\>]+/g;

async function updateAll() {
  console.log('🚀 Starting S3 URL updates for Blogs, Settings, and MediaAssets...\n');

  // 1. UPDATE SETTINGS
  console.log('--- 1. Updating Settings ---');
  const settings = await prisma.setting.findMany();
  let updatedSettingsCount = 0;

  for (const s of settings) {
    if (s.value && s.value.includes('cloudinary')) {
      let newValue = s.value;
      const matches = s.value.match(CLOUDINARY_REGEX) || [];
      const uniqueUrls = Array.from(new Set(matches));

      for (const cloudUrl of uniqueUrls) {
        const s3Url = findS3Url(cloudUrl);
        if (s3Url) {
          newValue = newValue.replaceAll(cloudUrl, s3Url);
        } else {
          console.warn(`⚠️ Warning: No S3 URL found for ${cloudUrl} in setting ${s.key}`);
        }
      }

      if (newValue !== s.value) {
        await prisma.setting.update({
          where: { id: s.id },
          data: { value: newValue }
        });
        updatedSettingsCount++;
        console.log(`✅ Setting "${s.key}" updated to S3 URLs.`);
      }
    }
  }

  // 2. UPDATE MEDIA ASSETS
  console.log('\n--- 2. Updating MediaAssets ---');
  const mediaAssets = await prisma.mediaAsset.findMany();
  let updatedMediaCount = 0;

  for (const m of mediaAssets) {
    if (m.url && m.url.includes('cloudinary')) {
      const s3Url = findS3Url(m.url);
      if (s3Url) {
        await prisma.mediaAsset.update({
          where: { id: m.id },
          data: { url: s3Url }
        });
        updatedMediaCount++;
        console.log(`✅ MediaAsset "${m.name}" updated to S3: ${s3Url}`);
      } else {
        console.warn(`⚠️ Warning: No S3 URL found for ${m.url}`);
      }
    }
  }

  // 3. UPDATE BLOGS
  console.log('\n--- 3. Updating Blogs ---');
  const blogs = await prisma.blog.findMany();
  let updatedBlogsCount = 0;

  for (const b of blogs) {
    let newImage = b.image;
    let newContent = b.content;
    let shouldUpdate = false;

    // Check featured image
    if (b.image && b.image.includes('cloudinary')) {
      const s3Url = findS3Url(b.image);
      if (s3Url) {
        newImage = s3Url;
        shouldUpdate = true;
      } else {
        console.warn(`⚠️ Warning: No S3 URL found for blog image: ${b.image}`);
      }
    }

    // Check content
    if (b.content && b.content.includes('cloudinary')) {
      const matches = b.content.match(CLOUDINARY_REGEX) || [];
      const uniqueUrls = Array.from(new Set(matches));

      for (const cloudUrl of uniqueUrls) {
        const s3Url = findS3Url(cloudUrl);
        if (s3Url) {
          newContent = newContent.replaceAll(cloudUrl, s3Url);
          shouldUpdate = true;
        } else {
          console.warn(`⚠️ Warning: No S3 URL found for blog content image: ${cloudUrl}`);
        }
      }
    }

    if (shouldUpdate) {
      await prisma.blog.update({
        where: { id: b.id },
        data: {
          image: newImage,
          content: newContent
        }
      });
      updatedBlogsCount++;
      console.log(`✅ Blog "${b.title}" updated to S3.`);
    }
  }

  console.log('\n========================================');
  console.log(`🎉 COMPLETED ALL UPDATES:`);
  console.log(`   - Settings updated: ${updatedSettingsCount}`);
  console.log(`   - MediaAssets updated: ${updatedMediaCount}`);
  console.log(`   - Blogs updated: ${updatedBlogsCount}`);
  console.log('========================================');
}

updateAll()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
