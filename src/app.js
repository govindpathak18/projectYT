import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";

import { ApiError } from "./utils/ApiError.js";

const app = express();

app.use( // for development, in production, you should set the CORS_ORIGIN to your frontend URL
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json({ limit: "16kb" })); // limit the size of the request body to prevent DoS attacks
app.use(express.urlencoded({ extended: true, limit: "16kb" })); // limit the size of the URL-encoded request body to prevent DoS attacks
app.use(express.static("public")); // serve static files from the "public" directory
app.use(cookieParser()); // parse cookies and populate req.cookies with an object keyed by the cookie names


//routes import
import healthcheckRouter from "./routes/healthcheck.routes.js";
import userRouter from "./routes/user.routes.js";


//route declarations
app.use("/api/v1/healthcheck", healthcheckRouter);
app.use("/api/v1/users", userRouter);




app.use((req, res, next) => { // runs when no route is matched
  next(new ApiError(404, `Route not found: ${req.originalUrl}`));
});


// global error handler
app.use((err, req, res, next) => { 
  const statusCode = err.statusCode || 500;

  return res.status(statusCode).json({
    success: false,
    statusCode,
    message: err.message || "Internal server error",
    errors: err.errors || [],
    data: null,
  });
});

export { app };
