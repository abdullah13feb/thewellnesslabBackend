require('dotenv').config();
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const uploadImages = async () => {
  const localImages = [
    'd:\\thewellnesslab\\adminPortal\\public\\heroImage.jpeg'
  ];

  for (const path of localImages) {
    try {
      const result = await cloudinary.uploader.upload(path, { folder: "email_campaigns" });
      console.log(`Uploaded ${path}:`, result.secure_url);
    } catch (error) {
      console.error(`Error uploading ${path}:`, error);
    }
  }
};

uploadImages();
