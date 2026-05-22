import jwt from "jsonwebtoken";

import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";

const authenticate = asyncHandler(async (req, res, next) => {
    const cookieToken = req.cookies && req.cookies.accessToken; // Check for token in cookies first
    const header = req.headers.authorization; // Then check for token in Authorization header
    const bearerToken = header && header.startsWith("Bearer ") ? header.split(" ")[1] : null;

    const token = cookieToken || bearerToken;

    if (!token) {
        throw new ApiError(401, "Authentication credentials not found");
    }

    let decoded; // decoded token have userId
    try {
        decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
    } catch (err) {
        throw new ApiError(401, "Invalid or expired token");
    }

    const user = await User.findById(decoded._id);

    if (!user) {
        throw new ApiError(401, "User not found");
    }

    req.user = user; // Attach user to request object for downstream use
    next();
});

export { authenticate };

// This middleware can be used in routes to protect them
//  and ensure only authenticated users can access them
