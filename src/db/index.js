import mongoose from "mongoose";
import { DB_NAME } from "../constants.js";

const connectDB = async () => {
  const db_url = process.env.DB_URL;

  if (!db_url) {
    throw new Error("DB_URL is not defined in .env");
  }

  try {
    const connectionInstance = await mongoose.connect(`${db_url}/${DB_NAME}`);

    console.log(
      `MongoDB connected ✅: ${connectionInstance.connection.host}/${DB_NAME}`
    );

    return connectionInstance;
  } catch (error) {
    throw new Error(`MongoDB connection failed ❌: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
