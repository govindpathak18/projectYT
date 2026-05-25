import { Router } from "express";

import {
  forgotPassword,
  loginUser,
  registerUser,
  resetPassword,
  verifyEmail,
  logoutUser,
  refreshAccessToken,
  getCurrentUser,
  changePassword,
  updateAccountDetails,
  updateAvatar,
  updateCoverImage,
} from "../controllers/user.controller.js";
import { upload } from "../middlewares/multer.middleware.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = Router();

/**
 * @route POST /register
 * @description Register a user, upload avatar/cover image, and email OTP.
 * @access Public
 * @mount /api/v1/users
 * @body {string} fullName - User's display name.
 * @body {string} email - User's email address.
 * @body {string} username - Unique username.
 * @body {string} password - Plain password; hashed by User model.
 * @file {File} avatar - Required profile image.
 * @file {File} coverImage - Optional channel cover image.
 */
router.route("/register").post(
  upload.fields([
    {
      name: "avatar",
      maxCount: 1,
    },
    {
      name: "coverImage",
      maxCount: 1,
    },
  ]),
  registerUser
);

/**
 * @route POST /login
 * @description Login with email or username and password.
 * @access Public
 * @mount /api/v1/users
 * @body {string} email - User email. Required if username is not provided.
 * @body {string} username - Username. Required if email is not provided.
 * @body {string} password - User password.
 */
router.route("/login").post(loginUser);

/**
 * @route POST /verify-email
 * @description Verify a user's email using the OTP sent by email.
 * @access Public
 * @body {string} email - Registered user email.
 * @body {string} otp - OTP sent to the user's email.
 */
router.route("/verify-email").post(verifyEmail);

/**
 * @route POST /forgot-password
 * @description Send a password reset OTP to the user's email.
 * @access Public
 * @mount /api/v1/users
 * @body {string} email - Registered user email.
 */
router.route("/forgot-password").post(forgotPassword);

/**
 * @route POST /reset-password
 * @description Reset password using email and password reset OTP.
 * @access Public
 * @mount /api/v1/users
 * @body {string} email - Registered user email.
 * @body {string} otp - Password reset OTP sent by email.
 * @body {string} newPassword - New password to save.
 */
router.route("/reset-password").post(resetPassword);


//secured routes

/**
 * @route POST /logout
 * @description Log out the authenticated user, clear cookies, and revoke refresh token.
 * @access Private
 * @mount /api/v1/users
 */
router.route("/logout").post(authenticate, logoutUser);

/**
 * @route POST /refresh-token
 * @description Refresh access token using a valid refresh token from cookie or header.
 * @access Public
 * @mount /api/v1/users
 * @header {string} Authorization - Optional: Bearer <refreshToken>
 * @cookie {string} refreshToken - Optional: refresh token from cookies
 */
router.route("/refresh-token").post(refreshAccessToken);

/**
 * @route PATCH /update-avatar
 * @description Update the authenticated user's avatar image.
 * @access Private
 * @file {File} avatar - Required avatar image.
 */
router
  .route("/update-avatar")
  .patch(authenticate, upload.single("avatar"), updateAvatar);

/**
 * @route PATCH /update-cover-image
 * @description Update the authenticated user's cover image.
 * @access Private
 * @file {File} coverImage - Required cover image.
 */
router
  .route("/update-cover-image")
  .patch(authenticate, upload.single("coverImage"), updateCoverImage);

/**
 * @route GET /current-user
 * @description Get the authenticated user's profile.
 * @access Private
 */
router.route("/current-user").get(authenticate, getCurrentUser);

/**
 * @route PATCH /update-account-details
 * @description Update the authenticated user's profile details.
 * @access Private
 * @body {string} fullName - User's display name.
 * @body {string} username - Unique username.
 * @body {string} email - User email.
 */
router.route("/update-account-details").patch(authenticate, updateAccountDetails);

/**
 * @route PATCH /change-password
 * @description Change the authenticated user's password.
 * @access Private
 * @body {string} currentPassword - User's current password.
 * @body {string} newPassword - New password to save.
 */
router.route("/change-password").patch(authenticate, changePassword);

export default router;
