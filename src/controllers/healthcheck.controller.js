import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const healthcheck = asyncHandler(async (req, res) => {
  // Return basic runtime info so clients can confirm the API is alive.
  return res.status(200).json(
    new ApiResponse(200, {
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    })
  );
});

export { healthcheck };
