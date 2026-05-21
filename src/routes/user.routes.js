import { Router } from "express";

import { registerUser } from "../controllers/user.controller.js";
import { upload } from "../middlewares/multer.middleware.js";

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

export default router;
