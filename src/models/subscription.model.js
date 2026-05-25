import mongoose,{Schema} from "mongoose";
import User from "./user.model.js";

const subscriptionSchema = new mongoose.Schema({
    subscriber: { // user who subscribes
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    channel: { // user who is being subscribed to
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    }
},{ timestamps: true });

export const Subscription = mongoose.model("Subscription", subscriptionSchema);