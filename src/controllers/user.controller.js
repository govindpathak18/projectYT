import crypto from "crypto";
import fs from "fs";
import jwt from "jsonwebtoken";

import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import {
  sendEmailVerificationOtp,
  sendPasswordResetOtp,
} from "../utils/email.js";

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

const generateAccessAndRefreshTokens = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const accessToken = user.generateAccessToken();
  const refreshToken = user.generateRefreshToken();

  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken };
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

const loginUser = asyncHandler(async (req, res) => {
  const { email, username, password } = req.body;

  if (!email && !username) {
    throw new ApiError(400, "Email or username is required");
  }
  if (!password || password.trim() === "") {
    throw new ApiError(400, "please enter a valid password");
  }

  // Login can happen with either email or username.
  const user = await User.findOne({
    $or: [
      { email: email?.toLowerCase() },
      { username: username?.toLowerCase() },
    ],
  }).select("+password");

  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  // If email is not verified, send a fresh OTP and stop login before tokens.
  if (!user.isEmailVerified) {
    const emailVerificationOtp = generateOtp();

    user.setEmailVerificationOtp(emailVerificationOtp);
    await user.save({ validateBeforeSave: false });

    await sendEmailVerificationOtp({
      email: user.email,
      fullName: user.fullName,
      otp: emailVerificationOtp,
    });

    throw new ApiError(
      403,
      "Please verify your email before login. A new OTP has been sent to your email."
    );
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  const loggedInUser = await User.findById(user._id);

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          accessToken,
          refreshToken,
        },
        "User logged in successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user) {
    throw new ApiError(401, "User not authenticated");
  }

  // Revoke refresh token so it cannot be reused after logout.
  user.refreshToken = undefined;
  await user.save({ validateBeforeSave: false });

  // Clear tokens from cookies by setting them to empty and using the same cookie options.
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  };

  return res
    .status(200)
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || email.trim() === "") {
    throw new ApiError(400, "Email is required");
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new ApiError(404, "User with this email does not exist");
  }

  // Generate a separate OTP for password reset so it does not affect email verification.
  const passwordResetOtp = generateOtp();

  user.setPasswordResetOtp(passwordResetOtp);
  await user.save({ validateBeforeSave: false });

  await sendPasswordResetOtp({
    email: user.email,
    fullName: user.fullName,
    otp: passwordResetOtp,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password reset OTP sent to your email"));
});

const resetPassword = asyncHandler(async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (
    [email, otp, newPassword].some((field) => !field || field.trim() === "")
  ) {
    throw new ApiError(400, "Email, OTP, and new password are required");
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+passwordResetOtp +passwordResetOtpExpiry"
  );

  if (!user) {
    throw new ApiError(404, "User with this email does not exist");
  }

  const isOtpValid = user.isPasswordResetOtpValid(otp);

  if (!isOtpValid) {
    throw new ApiError(400, "Invalid or expired password reset OTP");
  }

  // Assigning password triggers the model pre-save hook to hash it.
  user.password = newPassword;
  user.passwordResetOtp = undefined;
  user.passwordResetOtpExpiry = undefined;
  user.refreshToken = undefined;

  await user.save();

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password reset successfully"));
});

const verifyEmail = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp || email.trim() === "" || otp.trim() === "") {
    throw new ApiError(400, "Email and OTP are required");
  }

  const user = await User.findOne({ email: email.toLowerCase() }).select(
    "+emailVerificationOtp +emailVerificationOtpExpiry +isEmailVerified"
  );

  if (!user) {
    throw new ApiError(404, "User with this email does not exist");
  }

  if (user.isEmailVerified) {
    return res
      .status(200)
      .json(new ApiResponse(200, {}, "Email is already verified"));
  }

  const isOtpValid = user.isEmailVerificationOtpValid(otp);

  if (!isOtpValid) {
    throw new ApiError(400, "Invalid or expired email verification OTP");
  }

  user.isEmailVerified = true;
  user.emailVerificationOtp = undefined;
  user.emailVerificationOtpExpiry = undefined;
  user.emailVerifiedAt = new Date();

  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Email verified successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const cookieToken = req.cookies && req.cookies.refreshToken; // Try to get refresh token from cookies
  const header = req.headers.authorization; // Or from Authorization header
  const bearerToken = header && header.startsWith("Bearer ") ? header.split(" ")[1] : null;

  const incomingRefreshToken = cookieToken || bearerToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthorized request");
  }

  let decoded; // decoded refresh token should contain user _id
  try {
    decoded = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET);
  } catch (err) {
    throw new ApiError(401, "Invalid or expired refresh token");
  }

  const user = await User.findById(decoded._id).select("+refreshToken");

  if (!user) {
    throw new ApiError(401, "User not found");
  }

  // Verify that the incoming refresh token matches the one stored in database
  if (incomingRefreshToken !== user.refreshToken) {
    throw new ApiError(401, "Refresh token has been revoked or does not match");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id);

  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions)
    .json(
      new ApiResponse(
        200,
        {
          accessToken,
          refreshToken,
        },
        "Access token refreshed successfully"
      )
    );
});

const getCurrentUser = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user) {
    throw new ApiError(401, "User not authenticated");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, { user }, "Current user fetched successfully"));
});

const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  // Validate required inputs before touching the database.
  if (!currentPassword || !newPassword || currentPassword.trim() === "" || newPassword.trim() === "") {
    throw new ApiError(400, "Current password and new password are required");
  }

  const user = await User.findById(req.user?._id).select("+password");

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  // Confirm current password matches the stored hash.
  const isCurrentPasswordValid = await user.isPasswordCorrect(currentPassword);

  if (!isCurrentPasswordValid) {
    throw new ApiError(401, "Current password is incorrect");
  }

  // Assigning password will trigger the pre-save hook to hash it.
  user.password = newPassword;
  user.refreshToken = undefined;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
  const { fullName, username, email } = req.body;

  if (!fullName || !username || !email) {
    throw new ApiError(400, "Full name, username, and email are required");
  }

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();

  const existingUser = await User.findOne({
    _id: { $ne: req.user?._id },
    $or: [{ username: normalizedUsername }, { email: normalizedEmail }],
  });

  if (existingUser) {
    throw new ApiError(409, "Username or email already exists");
  }

  //update details
  req.user.fullName = fullName.trim();
  req.user.username = normalizedUsername;
  req.user.email = normalizedEmail;

  await req.user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: req.user },
        "Account details updated successfully"
      )
    );
});

const updateAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.files?.avatar?.[0]?.path;

  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar image is required");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);

  if (!avatar) {
    throw new ApiError(500, "Failed to upload avatar");
  }

  req.user.avatar = avatar.secure_url;
  await req.user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, { user: req.user }, "Avatar updated successfully"));
});

const updateCoverImage = asyncHandler(async (req, res) => {
  const coverImageLocalPath = req.files?.coverImage?.[0]?.path;

  if (!coverImageLocalPath) {
    throw new ApiError(400, "Cover image is required");
  }

  const coverImage = await uploadOnCloudinary(coverImageLocalPath);

  if (!coverImage) {
    throw new ApiError(500, "Failed to upload cover image");
  }

  req.user.coverImage = coverImage.secure_url;
  await req.user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(
      new ApiResponse(200, { user: req.user }, "Cover image updated successfully")
    );
});

export {
  forgotPassword,
  loginUser,
  registerUser,
  resetPassword,
  verifyEmail,
  logoutUser,
  refreshAccessToken,
  changePassword,
  getCurrentUser,
  updateAccountDetails,
  updateAvatar,
  updateCoverImage
};
