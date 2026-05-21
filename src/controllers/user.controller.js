import crypto from "crypto";
import fs from "fs";

import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { sendEmailVerificationOtp } from "../utils/email.js";

const generateOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

const removeLocalFile = (localFilePath) => {
  if (localFilePath && fs.existsSync(localFilePath)) {
    fs.unlinkSync(localFilePath);
  }
};

const removeUploadedFiles = (files = {}) => {
  Object.values(files)
    .flat()
    .forEach((file) => removeLocalFile(file?.path));
};

const registerUser = asyncHandler(async (req, res) => {
  // Frontend must send multipart/form-data with fullName, email, username,
  // password, avatar file, and optionally coverImage file.
  const { fullName, email, username, password } = req.body;

  // If validation fails after Multer saves files locally, remove those temp files.
  if (
    [fullName, email, username, password].some(
      (field) => !field || field.trim() === ""
    )
  ) {
    removeUploadedFiles(req.files);
    throw new ApiError(400, "All fields are required");
  }

  // A user cannot register with an existing email or username.
  const existingUser = await User.findOne({
    $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }],
  });

  if (existingUser) {
    removeUploadedFiles(req.files);
    throw new ApiError(409, "User with email or username already exists");
  }

  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

  // Avatar is required because User.avatar stores the final Cloudinary URL.
  if (!avatarLocalPath) {
    removeUploadedFiles(req.files);
    throw new ApiError(400, "Avatar file is required");
  }

  // Upload temp local files to Cloudinary, then cloudinary.js removes local files.
  const avatar = await uploadOnCloudinary(avatarLocalPath);
  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!avatar) {
    removeLocalFile(coverImageLocalPath);
    throw new ApiError(500, "Failed to upload avatar");
  }

  // generates otp once all validations passed
  const emailVerificationOtp = generateOtp();

  // Password hashing happens automatically in the User model pre-save hook.
  const user = await User.create({
    fullName,
    avatar: avatar.secure_url,
    coverImage: coverImage?.secure_url || "",
    email,
    username,
    password,
    isEmailVerified: false,
  });

  // Store only the hashed OTP in DB; send the raw OTP to the user's email.
  user.setEmailVerificationOtp(emailVerificationOtp);
  await user.save({ validateBeforeSave: false });

  await sendEmailVerificationOtp({
    email: user.email,
    fullName: user.fullName,
    otp: emailVerificationOtp,
  });

  const createdUser = await User.findById(user._id);

  if (!createdUser) {
    throw new ApiError(500, "Something went wrong while registering the user");
  }

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        user: createdUser,
      },
      "User registered successfully. Please verify your email."
    )
  );
});

export { registerUser };
