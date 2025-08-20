// Create a new file: models/RestaurantAnalysis.js

const mongoose = require("mongoose");

const RestaurantAnalysisSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
      index: true,
    },
    customerCode: {
      type: String,
      required: true,
    },
    customerName: {
      type: String,
      required: true,
    },
    restaurant_url: {
      type: String,
      required: true,
    },
    job_id: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["running", "completed", "failed"],
      default: "running",
    },
    restaurant_name: String,
    total_matches: {
      type: Number,
      default: 0,
    },
    restaurant_categories: [String],
    llm_categorization_used: {
      type: Boolean,
      default: false,
    },
    matching_results: [
      {
        hfd_item_no: String,
        hfd_description: String,
        matched_categories: [String],
        confidence_score: Number,
        matching_reason: String,
      },
    ],
    error_message: String,
    created_at: {
      type: Date,
      default: Date.now,
    },
    updated_at: {
      type: Date,
      default: Date.now,
    },
    completed_at: Date,
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
RestaurantAnalysisSchema.index({ customerId: 1, created_at: -1 });
RestaurantAnalysisSchema.index({ job_id: 1 });

// Update the updated_at field before saving
RestaurantAnalysisSchema.pre("save", function (next) {
  this.updated_at = new Date();
  next();
});

module.exports = mongoose.model("RestaurantAnalysis", RestaurantAnalysisSchema);
