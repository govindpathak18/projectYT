import crypto from "crypto";
import fs from "fs";
import jwt from "jsonwebtoken";

import { User } from "../models/user.model.js";
import { Subscription } from "../models/subscription.model.js";
import { Video } from "../models/video.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { deleteFromCloudinary, uploadOnCloudinary } from "../utils/cloudinary.js";
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

const resendVerificationOtp = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email || email.trim() === "") {
    throw new ApiError(400, "Email is required");
  }

  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    throw new ApiError(404, "User with this email does not exist");
  }

  if (user.isEmailVerified) {
    return res
      .status(200)
      .json(new ApiResponse(200, {}, "Email is already verified"));
  }

  const emailVerificationOtp = generateOtp();

  user.setEmailVerificationOtp(emailVerificationOtp);
  await user.save({ validateBeforeSave: false });

  await sendEmailVerificationOtp({
    email: user.email,
    fullName: user.fullName,
    otp: emailVerificationOtp,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Verification OTP resent successfully"));
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

// (**)
const getUserProfile = asyncHandler(async (req, res) => {

  // logged in user
  const { username } = req.params;

  if (!username || username.trim() === "") {
    throw new ApiError(400, "Username is required");
  }

  const normalizedUsername = username.trim().toLowerCase();

  // First pipeline: fetch the channel's base profile and the public relationship data.
  const [channelProfile] = await User.aggregate([
    // Find the channel by username.
    { $match: { username: normalizedUsername } },

    // Pull the counts for people who subscribe to this channel and channels this user follows.
    {
      $lookup: {
        from: "subscriptions",
        let: { channelId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$channel", "$$channelId"] },
            },
          },
          { $count: "count" },
        ],
        as: "subscriberCountDocs",
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        let: { channelId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$subscriber", "$$channelId"] },
            },
          },
          { $count: "count" },
        ],
        as: "subscribedCountDocs",
      },
    },

    // Pull the public list of channels this profile owner is following.
    {
      $lookup: {
        from: "subscriptions",
        let: { channelId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$subscriber", "$$channelId"] },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "channel",
              foreignField: "_id",
              as: "channelDoc",
            },
          },
          { $unwind: { path: "$channelDoc", preserveNullAndEmptyArrays: true } },
          { $replaceRoot: { newRoot: "$channelDoc" } },
          {
            $project: {
              _id: 1,
              username: 1,
              fullName: 1,
              avatar: 1,
              coverImage: 1,
              bio: 1,
            },
          },
        ],
        as: "subscribedAccounts",
      },
    },

    // Return only the fields needed for the response.
    {
      $project: {
        _id: 1,
        username: 1,
        fullName: 1,
        bio: 1,
        avatar: 1,
        coverImage: 1,
        subscriberCount: {
          $ifNull: [{ $arrayElemAt: ["$subscriberCountDocs.count", 0] }, 0],
        },
        subscribedCount: {
          $ifNull: [{ $arrayElemAt: ["$subscribedCountDocs.count", 0] }, 0],
        },
        subscribedAccounts: 1,
      },
    },
  ]);

  if (!channelProfile) {
    throw new ApiError(404, "User not found");
  }

  // We still need a separate boolean check for whether the current viewer is already subscribed.
  // This is a small targeted query and keeps the pipeline focused on profile data.
  const isOwner = req.user && req.user._id.toString() === channelProfile._id.toString();
  const isSubscribed = req.user
    ? await Subscription.exists({
      subscriber: req.user._id,
      channel: channelProfile._id,
    })
    : false;

  // Fetch the channel's videos. Public viewers only get published videos, while the owner can see all uploads.
  const videos = await Video.aggregate([
    {
      $match: isOwner
        ? { owner: channelProfile._id }
        : { owner: channelProfile._id, isPublished: true },
    },
    {
      $sort: { createdAt: -1 },
    },
    {
      $project: {
        _id: 1,
        title: 1,
        description: 1,
        thumbnail: 1,
        videoFile: 1,
        duration: 1,
        views: 1,
        isPublished: 1,
        createdAt: 1,
      },
    },
  ]);

  // If the viewer is the owner, fetch the owner-only list of users who subscribe to this channel.
  let subscriberAccounts = [];

  if (isOwner) {
    const [ownerData] = await User.aggregate([
      { $match: { _id: channelProfile._id } },
      {
        $lookup: {
          from: "subscriptions",
          let: { channelId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$channel", "$$channelId"] },
              },
            },
            {
              $lookup: {
                from: "users",
                localField: "subscriber",
                foreignField: "_id",
                as: "subscriberDoc",
              },
            },
            { $unwind: { path: "$subscriberDoc", preserveNullAndEmptyArrays: true } },
            { $replaceRoot: { newRoot: "$subscriberDoc" } },
            {
              $project: {
                _id: 1,
                username: 1,
                fullName: 1,
                avatar: 1,
                coverImage: 1,
                bio: 1,
              },
            },
          ],
          as: "subscriberAccounts",
        },
      },
      {
        $project: {
          subscriberAccounts: 1,
        },
      },
    ]);

    subscriberAccounts = ownerData?.subscriberAccounts || [];
  }

  const profile = {
    username: channelProfile.username,
    fullName: channelProfile.fullName,
    bio: channelProfile.bio || "",
    avatar: channelProfile.avatar,
    coverImage: channelProfile.coverImage || "",
    subscriberCount: channelProfile.subscriberCount,
    subscribedCount: channelProfile.subscribedCount,
    subscribedAccounts: channelProfile.subscribedAccounts,
    isSubscribed,
    videos,
  };

  if (isOwner) {
    profile.subscriberAccounts = subscriberAccounts;
  }

  return res
    .status(200)
    .json(new ApiResponse(200, { profile }, "User profile fetched successfully"));
});

const subscribeToChannel = asyncHandler(async (req, res) => {
  const user = req.user;
  const { channelId } = req.params;

  if (!user) {
    throw new ApiError(401, "User not authenticated");
  }

  if (!channelId || channelId.trim() === "") {
    throw new ApiError(400, "Channel ID is required");
  }

  if (user._id.toString() === channelId) {
    throw new ApiError(400, "You cannot subscribe to yourself");
  }

  const channel = await User.findById(channelId);

  if (!channel) {
    throw new ApiError(404, "Channel not found");
  }

  const existingSubscription = await Subscription.findOne({
    subscriber: user._id,
    channel: channel._id,
  });

  if (existingSubscription) {
    throw new ApiError(409, "You are already subscribed to this channel");
  }

  const subscription = await Subscription.create({
    subscriber: user._id,
    channel: channel._id,
  });

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { subscription },
        "Subscribed to channel successfully"
      )
    );
});

const unsubscribeFromChannel = asyncHandler(async (req, res) => {
  const user = req.user;
  const { channelId } = req.params;

  if (!user) {
    throw new ApiError(401, "User not authenticated");
  }

  if (!channelId || channelId.trim() === "") {
    throw new ApiError(400, "Channel ID is required");
  }

  const channel = await User.findById(channelId);

  if (!channel) {
    throw new ApiError(404, "Channel not found");
  }

  const deletedSubscription = await Subscription.findOneAndDelete({
    subscriber: user._id,
    channel: channel._id,
  });

  if (!deletedSubscription) {
    throw new ApiError(404, "Subscription not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Unsubscribed from channel successfully"));
});

const getWatchHistory = asyncHandler(async (req, res) => {
  const user = req.user;

  if (!user) {
    throw new ApiError(401, "User not authenticated");
  }

  const userWithWatchHistory = await User.findById(user._id)
    .populate({
      path: "watchHistory",
      select:
        "_id title description thumbnail videoFile duration views isPublished createdAt updatedAt",
      options: { sort: { createdAt: -1 } },
    })
    .select("watchHistory");

  const watchHistory = userWithWatchHistory?.watchHistory || [];

  return res
    .status(200)
    .json(
      new ApiResponse(200, { watchHistory }, "Watch history fetched successfully")
    );
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
  const { fullName, username, email, bio } = req.body;

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
  req.user.bio = typeof bio === "string" ? bio.trim() : "";

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

  if (req.user.avatar) {
    await deleteFromCloudinary(req.user.avatar);
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

  if (req.user.coverImage) {
    await deleteFromCloudinary(req.user.coverImage);
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
  resendVerificationOtp,
  logoutUser,
  refreshAccessToken,
  changePassword,
  getCurrentUser,
  getUserProfile,
  getWatchHistory,
  subscribeToChannel,
  unsubscribeFromChannel,
  updateAccountDetails,
  updateAvatar,
  updateCoverImage
};
