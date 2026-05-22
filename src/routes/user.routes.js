import { Router } from "express";

import {
  forgotPassword,
  loginUser,
  registerUser,
  resetPassword,
  verifyEmail,
  logoutUser,
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




export default router;
