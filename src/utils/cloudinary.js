import { v2 as cloudinary } from "cloudinary";
import fs from "fs";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadOnCloudinary = async (localFilePath) => {
  if (!localFilePath) {
    return null;
  }

  try {
    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto",
    });

    removeLocalFile(localFilePath);
    return response;
  } catch (error) {
    removeLocalFile(localFilePath);
    return null;
  }
};

const deleteFromCloudinary = async (cloudinaryUrl) => {
  if (!cloudinaryUrl) {
    return;
  }

  try {
    const publicId = cloudinaryUrl.split("/").slice(-2).join("/").split(".")[0];

    if (!publicId) {
      return;
    }

    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
    });
  } catch (error) {
    return;
  }
};

const removeLocalFile = (localFilePath) => {
  if (localFilePath && fs.existsSync(localFilePath)) {
    fs.unlinkSync(localFilePath);
  }
};

export { deleteFromCloudinary, uploadOnCloudinary };
