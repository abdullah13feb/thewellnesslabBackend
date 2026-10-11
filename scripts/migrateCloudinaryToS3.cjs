#!/usr/bin/env node

/**
 * Cloudinary to AWS S3 Migration Script
 * 
 * Purpose:
 * 1. Download all images from Cloudinary to a local directory.
 * 2. Ensure / Create a public AWS S3 bucket based on credentials in .env.
 * 3. Configure public read access and CORS on the S3 bucket.
 * 4. Upload all downloaded images to the AWS S3 bucket.
 * 5. Generate a comprehensive mapping JSON (cloudinary_to_s3_mapping.json).
 * 
 * NOTE: This script does NOT touch, query, or modify the database.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const AWS = require('aws-sdk');
const cloudinary = require('cloudinary').v2;

// Load .env from backend root
const envPath = path.resolve(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

// Parse command line arguments
const args = process.argv.slice(2);
function getArg(name, defaultValue = null) {
  const prefix = `--${name}=`;
  const match = args.find(a => a.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  if (args.includes(`--${name}`)) return true;
  return defaultValue;
}

const BUCKET_NAME = getArg('bucket') || process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME || 'thewellnesslab-public-assets';
const AWS_REGION = getArg('region') || process.env.AWS_REGION || 'ap-south-1';
const CONCURRENCY = parseInt(getArg('concurrency', '8'), 10);
const DOWNLOAD_ONLY = args.includes('--download-only');
const UPLOAD_ONLY = args.includes('--upload-only');
const INCLUDE_ALL = args.includes('--all'); // include video & raw in addition to images
const FORCE = args.includes('--force');
const CLEAN_LOCAL = args.includes('--clean-local');

const DOWNLOAD_DIR = path.resolve(__dirname, '../downloads/cloudinary');
const MAPPING_FILE = path.resolve(__dirname, '../cloudinary_to_s3_mapping.json');
const SUMMARY_FILE = path.resolve(__dirname, '../migration_summary.json');

// MIME types lookup
const MIME_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  json: 'application/json'
};

function getMimeType(filename, format) {
  const ext = (format || path.extname(filename).replace('.', '')).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// Initialize AWS S3
const awsAccessKey = process.env.AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY;
const awsSecretKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.AWS_SCERET_KEY;

if (!awsAccessKey || !awsSecretKey) {
  console.error('❌ Error: AWS credentials missing in .env (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)');
  process.exit(1);
}

const s3 = new AWS.S3({
  accessKeyId: awsAccessKey,
  secretAccessKey: awsSecretKey,
  region: AWS_REGION
});

// Initialize Cloudinary
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const cloudApiKey = process.env.CLOUDINARY_API_KEY;
const cloudApiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !cloudApiKey || !cloudApiSecret) {
  console.error('❌ Error: Cloudinary credentials missing in .env (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)');
  process.exit(1);
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: cloudApiKey,
  api_secret: cloudApiSecret,
  secure: true
});

// Helper: Ensure directory exists
function ensureDirSync(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// Helper: Concurrency worker pool
async function pMap(items, mapper, concurrency) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      try {
        results[i] = await mapper(items[i], i);
      } catch (err) {
        results[i] = { error: err.message, item: items[i] };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Step 1: Ensure public S3 bucket exists with public read policy
async function ensurePublicS3Bucket(bucketName, region) {
  console.log(`\n========================================`);
  console.log(`📦 AWS S3 BUCKET SETUP: "${bucketName}" (Region: ${region})`);
  console.log(`========================================`);

  // 1. Check if bucket exists
  let bucketExists = false;
  try {
    await s3.headBucket({ Bucket: bucketName }).promise();
    console.log(`✅ S3 Bucket "${bucketName}" already exists.`);
    bucketExists = true;
  } catch (err) {
    if (err.statusCode === 404 || err.code === 'NotFound') {
      console.log(`ℹ️ Bucket "${bucketName}" does not exist. Creating now...`);
      const createParams = { Bucket: bucketName };
      if (region && region !== 'us-east-1') {
        createParams.CreateBucketConfiguration = { LocationConstraint: region };
      }
      await s3.createBucket(createParams).promise();
      console.log(`✅ Successfully created bucket "${bucketName}".`);
      bucketExists = true;
    } else {
      console.error(`❌ Error checking/creating bucket:`, err.message);
      throw err;
    }
  }

  // 2. Disable Block Public Access
  console.log(`🔓 Configuring Public Access permissions...`);
  try {
    await s3.putPublicAccessBlock({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false
      }
    }).promise();
    console.log(`✅ Block Public Access disabled.`);
  } catch (err) {
    console.warn(`⚠️ Warning setting PublicAccessBlock (might already be configured):`, err.message);
  }

  // 3. Set Bucket Policy for Public Read GetObject
  console.log(`📜 Attaching Public Read Bucket Policy...`);
  const publicPolicy = {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicReadGetObject',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${bucketName}/*`
      }
    ]
  };

  try {
    await s3.putBucketPolicy({
      Bucket: bucketName,
      Policy: JSON.stringify(publicPolicy)
    }).promise();
    console.log(`✅ Public read policy attached.`);
  } catch (err) {
    console.warn(`⚠️ Warning attaching bucket policy:`, err.message);
  }

  // 4. Set CORS for web / frontend image loading
  console.log(`🌐 Setting CORS configuration for web access...`);
  try {
    await s3.putBucketCors({
      Bucket: bucketName,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedHeaders: ['*'],
            AllowedMethods: ['GET', 'HEAD'],
            AllowedOrigins: ['*'],
            MaxAgeSeconds: 3000
          }
        ]
      }
    }).promise();
    console.log(`✅ CORS configuration applied.`);
  } catch (err) {
    console.warn(`⚠️ Warning setting CORS:`, err.message);
  }
}

// Step 2: Fetch all Cloudinary resources
async function fetchCloudinaryResources() {
  console.log(`\n========================================`);
  console.log(`🔍 FETCHING ASSET LIST FROM CLOUDINARY`);
  console.log(`========================================`);

  const typesToFetch = INCLUDE_ALL ? ['image', 'video', 'raw'] : ['image'];
  const allResources = [];

  for (const resourceType of typesToFetch) {
    console.log(`Fetching ${resourceType}s from Cloudinary...`);
    let nextCursor = null;
    let page = 1;

    do {
      const res = await cloudinary.api.resources({
        resource_type: resourceType,
        max_results: 500,
        next_cursor: nextCursor
      });

      for (const item of res.resources) {
        // Construct full filename and S3 key
        let filename = item.public_id;
        if (item.format && !filename.toLowerCase().endsWith(`.${item.format.toLowerCase()}`)) {
          filename = `${filename}.${item.format}`;
        }

        allResources.push({
          public_id: item.public_id,
          format: item.format,
          resource_type: item.resource_type,
          type: item.type,
          bytes: item.bytes,
          width: item.width,
          height: item.height,
          secure_url: item.secure_url,
          filename: filename,
          s3_key: filename
        });
      }

      console.log(`  Fetched page ${page}: ${res.resources.length} ${resourceType}s (Total so far: ${allResources.length})`);
      nextCursor = res.next_cursor;
      page++;
    } while (nextCursor);
  }

  const totalBytes = allResources.reduce((sum, r) => sum + (r.bytes || 0), 0);
  console.log(`\n✅ Total Cloudinary assets found: ${allResources.length} (~${(totalBytes / (1024 * 1024)).toFixed(2)} MB)`);
  return allResources;
}

// Download helper with retries
function downloadFile(url, destPath, retries = 3) {
  return new Promise((resolve, reject) => {
    ensureDirSync(path.dirname(destPath));

    const execute = (attempt) => {
      const fileStream = fs.createWriteStream(destPath);
      const client = url.startsWith('https') ? https : http;

      client.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          fileStream.close();
          fs.unlinkSync(destPath);
          return downloadFile(response.headers.location, destPath, retries).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          fileStream.close();
          if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
          if (attempt < retries) {
            return setTimeout(() => execute(attempt + 1), 1000);
          }
          return reject(new Error(`HTTP ${response.statusCode} downloading ${url}`));
        }

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(destPath));
        });
      }).on('error', (err) => {
        fileStream.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        if (attempt < retries) {
          return setTimeout(() => execute(attempt + 1), 1000);
        }
        reject(err);
      });
    };

    execute(1);
  });
}

// Step 3: Download assets to local directory
async function downloadAllAssets(resources) {
  console.log(`\n========================================`);
  console.log(`⬇️ DOWNLOADING ASSETS LOCALLY TO:`);
  console.log(`   ${DOWNLOAD_DIR}`);
  console.log(`========================================`);

  ensureDirSync(DOWNLOAD_DIR);
  let downloadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  await pMap(resources, async (item, idx) => {
    const localPath = path.join(DOWNLOAD_DIR, item.filename);
    item.local_path = localPath;

    // Check if already downloaded
    if (!FORCE && fs.existsSync(localPath)) {
      const stats = fs.statSync(localPath);
      if (stats.size > 0) {
        skippedCount++;
        item.download_status = 'already_downloaded';
        if ((idx + 1) % 25 === 0 || idx + 1 === resources.length) {
          console.log(`  [${idx + 1}/${resources.length}] Progress: ${downloadedCount} downloaded, ${skippedCount} skipped, ${failedCount} failed`);
        }
        return;
      }
    }

    try {
      await downloadFile(item.secure_url, localPath);
      downloadedCount++;
      item.download_status = 'downloaded';
      if ((idx + 1) % 25 === 0 || idx + 1 === resources.length) {
        console.log(`  [${idx + 1}/${resources.length}] Progress: ${downloadedCount} downloaded, ${skippedCount} skipped, ${failedCount} failed`);
      }
    } catch (err) {
      failedCount++;
      item.download_status = 'failed';
      item.download_error = err.message;
      console.error(`  ❌ Failed to download ${item.secure_url}: ${err.message}`);
    }
  }, CONCURRENCY);

  console.log(`\n✅ Download summary: ${downloadedCount} downloaded, ${skippedCount} skipped (already existed), ${failedCount} failed.`);
}

// Step 4: Upload all downloaded assets to S3
async function uploadAllToS3(resources, bucketName, region) {
  console.log(`\n========================================`);
  console.log(`⬆️ UPLOADING ASSETS TO AWS S3 BUCKET: "${bucketName}"`);
  console.log(`========================================`);

  let uploadedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  await pMap(resources, async (item, idx) => {
    const localPath = item.local_path || path.join(DOWNLOAD_DIR, item.filename);
    const s3Key = item.s3_key;
    const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${s3Key}`;
    item.s3_url = publicUrl;

    if (!fs.existsSync(localPath)) {
      item.upload_status = 'failed';
      item.upload_error = 'Local file not found';
      failedCount++;
      return;
    }

    // Check if S3 object already exists unless FORCE
    if (!FORCE) {
      try {
        await s3.headObject({ Bucket: bucketName, Key: s3Key }).promise();
        skippedCount++;
        item.upload_status = 'already_on_s3';
        if ((idx + 1) % 25 === 0 || idx + 1 === resources.length) {
          console.log(`  [${idx + 1}/${resources.length}] Progress: ${uploadedCount} uploaded, ${skippedCount} skipped, ${failedCount} failed`);
        }
        return;
      } catch (headErr) {
        // Not found, proceed with upload
      }
    }

    const contentType = getMimeType(item.filename, item.format);
    const fileStream = fs.createReadStream(localPath);

    try {
      await s3.upload({
        Bucket: bucketName,
        Key: s3Key,
        Body: fileStream,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable'
      }).promise();

      uploadedCount++;
      item.upload_status = 'uploaded';
      if ((idx + 1) % 25 === 0 || idx + 1 === resources.length) {
        console.log(`  [${idx + 1}/${resources.length}] Progress: ${uploadedCount} uploaded, ${skippedCount} skipped, ${failedCount} failed`);
      }
    } catch (uploadErr) {
      failedCount++;
      item.upload_status = 'failed';
      item.upload_error = uploadErr.message;
      console.error(`  ❌ Failed uploading ${s3Key} to S3: ${uploadErr.message}`);
    }
  }, CONCURRENCY);

  console.log(`\n✅ Upload summary: ${uploadedCount} uploaded, ${skippedCount} skipped (already existed on S3), ${failedCount} failed.`);
}

// Main execution routine
async function main() {
  const startTime = new Date();
  console.log(`=======================================================`);
  console.log(`🚀 CLOUDINARY TO AWS S3 MIGRATION`);
  console.log(`   Target Bucket: ${BUCKET_NAME}`);
  console.log(`   AWS Region:    ${AWS_REGION}`);
  console.log(`   Concurrency:   ${CONCURRENCY}`);
  console.log(`   Mode:          ${DOWNLOAD_ONLY ? 'Download Only' : UPLOAD_ONLY ? 'Upload Only' : 'Download & Upload'}`);
  console.log(`   Include:       ${INCLUDE_ALL ? 'All media (image, video, raw)' : 'Images only'}`);
  console.log(`   Started at:    ${startTime.toISOString()}`);
  console.log(`=======================================================`);

  let resources = [];

  // Step 1: Set up bucket (unless download-only)
  if (!DOWNLOAD_ONLY) {
    await ensurePublicS3Bucket(BUCKET_NAME, AWS_REGION);
  }

  // Step 2: Fetch Cloudinary catalog
  resources = await fetchCloudinaryResources();

  if (resources.length === 0) {
    console.log('No resources found in Cloudinary. Exiting.');
    return;
  }

  // Step 3: Download assets locally
  if (!UPLOAD_ONLY) {
    await downloadAllAssets(resources);
  }

  // Step 4: Upload to S3
  if (!DOWNLOAD_ONLY) {
    await uploadAllToS3(resources, BUCKET_NAME, AWS_REGION);
  }

  // Step 5: Save Mapping and Summary Files
  console.log(`\n========================================`);
  console.log(`💾 SAVING MAPPING AND AUDIT SUMMARY`);
  console.log(`========================================`);

  const endTime = new Date();
  const summary = {
    started_at: startTime.toISOString(),
    completed_at: endTime.toISOString(),
    duration_seconds: ((endTime - startTime) / 1000).toFixed(1),
    bucket_name: BUCKET_NAME,
    aws_region: AWS_REGION,
    total_assets: resources.length,
    download_stats: {
      downloaded: resources.filter(r => r.download_status === 'downloaded').length,
      already_downloaded: resources.filter(r => r.download_status === 'already_downloaded').length,
      failed: resources.filter(r => r.download_status === 'failed').length
    },
    upload_stats: {
      uploaded: resources.filter(r => r.upload_status === 'uploaded').length,
      already_on_s3: resources.filter(r => r.upload_status === 'already_on_s3').length,
      failed: resources.filter(r => r.upload_status === 'failed').length
    },
    sample_mapping: resources.slice(0, 3).map(r => ({
      cloudinary_url: r.secure_url,
      s3_url: r.s3_url
    }))
  };

  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`✅ Summary report saved to: ${SUMMARY_FILE}`);

  fs.writeFileSync(MAPPING_FILE, JSON.stringify(resources, null, 2), 'utf-8');
  console.log(`✅ Complete mapping JSON saved to: ${MAPPING_FILE}`);

  // Step 6: Cleanup local download files if requested
  if (CLEAN_LOCAL && fs.existsSync(DOWNLOAD_DIR)) {
    console.log(`\n🧹 Cleaning up local downloaded files as requested...`);
    fs.rmSync(path.resolve(__dirname, '../downloads'), { recursive: true, force: true });
    console.log(`✅ Local downloads folder removed.`);
  }

  console.log(`\n🎉 MIGRATION PROCESS COMPLETE!`);
  console.log(`   Total assets processed: ${resources.length}`);
  console.log(`   Sample S3 URL: ${resources[0]?.s3_url}`);
  console.log(`   Database was NOT modified (kept 100% untouched).`);
}

main().catch((err) => {
  console.error(`\n💥 Fatal error during migration:`, err);
  process.exit(1);
});
