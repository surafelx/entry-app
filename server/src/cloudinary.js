import { v2 as cloudinary } from "cloudinary";
import fs from "node:fs";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = "visualspam";

export async function uploadMedia(localPath, publicId) {
  const res = await cloudinary.uploader.upload(localPath, {
    resource_type: "video",
    folder: FOLDER,
    public_id: publicId,
    overwrite: true,
  });
  return res.secure_url;
}

export async function uploadImage(localPath, publicId) {
  const res = await cloudinary.uploader.upload(localPath, {
    resource_type: "image",
    folder: FOLDER,
    public_id: publicId,
    overwrite: true,
  });
  return res.secure_url;
}

export async function deleteMedia(publicId) {
  try {
    await cloudinary.uploader.destroy(`${FOLDER}/${publicId}`, { resource_type: "video" });
  } catch {}
}

export function tmpPath(name) {
  return `/tmp/${name}`;
}

export function writeTmp(name, buffer) {
  const p = tmpPath(name);
  fs.writeFileSync(p, buffer);
  return p;
}

export function cleanupTmp(name) {
  try { fs.unlinkSync(tmpPath(name)); } catch {}
}

export { cloudinary };
