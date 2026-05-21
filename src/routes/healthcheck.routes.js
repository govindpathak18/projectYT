import { Router } from "express";

import { healthcheck } from "../controllers/healthcheck.controller.js";

const router = Router();

/**
 * @route GET /
 * @description Check whether the backend API is running.
 * @access Public
 * @mount /api/v1/healthcheck
 */
router.route("/").get(healthcheck);

export default router;
