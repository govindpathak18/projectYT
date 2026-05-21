import dotenv from "dotenv";
import express from "express";

import connectDB from "./db/index.js";

dotenv.config({ //
  path: "./.env",
});

const PORT = process.env.PORT || 8000;
const app = express();

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🎉 Server is running at port: ${PORT}`);
    });
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
