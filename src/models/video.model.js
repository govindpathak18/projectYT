import mongoose, { Schema } from "mongoose";
import mongooseAggregatePaginate from "mongoose-aggregate-paginate-v2";

const videoSchema = new Schema(
  {
    videoFile: {
      type: String,
      required: true,
    },
    thumbnail: {
      type: String,
      required: true,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
    },
    duration: {
      type: Number,
      required: true,
    },
    views: {
      type: Number,
      default: 0,
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
    publishedAt: {
      type: Date,
      default: function () {
        return this.isPublished ? new Date() : null;
      },
    },
  },
  { timestamps: true }
);

videoSchema.index({ owner: 1, createdAt: -1 });
videoSchema.index({ owner: 1, isPublished: 1, createdAt: -1 });
videoSchema.index({ owner: 1, views: -1 });
videoSchema.index({ isPublished: 1, createdAt: -1 });
videoSchema.index({ title: "text", description: "text" });

videoSchema.pre("save", function (next) {
  if (this.isModified("isPublished")) {
    this.publishedAt = this.isPublished ? new Date() : null;
  }

  next();
});

videoSchema.plugin(mongooseAggregatePaginate);

export const Video = mongoose.model("Video", videoSchema);
