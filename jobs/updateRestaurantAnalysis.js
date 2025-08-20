const axios = require("axios");
const RestaurantAnalysis = require("../models/RestaurantAnalysis");

const SCRAPER_API_URL =
  process.env.SCRAPER_API_URL || "https://hfs-ws.onrender.com";

async function updateRunningAnalyses() {
  try {
    // Find all running analyses
    const runningAnalyses = await RestaurantAnalysis.find({
      status: "running",
    });

    console.log(`Found ${runningAnalyses.length} running analyses to check`);

    for (const analysis of runningAnalyses) {
      try {
        // Check job status - CORRECTED ENDPOINT
        console.log(`Checking status for job ${analysis.job_id}`);
        const statusResponse = await axios.get(
          `${SCRAPER_API_URL}/inventory-matching-job/${analysis.job_id}`,
          {
            timeout: 10000,
          }
        );


        // CORRECTED: Access the data property
        if (statusResponse.data && statusResponse.data.success) {
          const jobData = statusResponse.data.job_status;

          console.log(`Job ${analysis.job_id} status: ${jobData.status}`);
   

          if (jobData.status === "completed" && jobData.result) {
            // Job completed, update with results
            const results = jobData.result;

            console.log(
              `Updating completed analysis for job ${analysis.job_id} with results:`,
              {
                restaurant_name: results.restaurant_name,
                total_matches: results.total_matches,
                categories_count: results.restaurant_categories?.length || 0,
                matches_count: results.matching_results?.length || 0,
              }
            );

            // Update analysis with results
            await RestaurantAnalysis.findByIdAndUpdate(analysis._id, {
              status: "completed",
              restaurant_name: results.restaurant_name,
              total_matches: results.total_matches,
              restaurant_categories: results.restaurant_categories,
              llm_categorization_used: results.llm_categorization_used,
              openai_enhancement_used: results.openai_enhancement_used,
              matching_results: results.matching_results,
              completed_at: new Date(),
              updated_at: new Date(),
            });

            console.log(
              `✅ Successfully updated completed analysis for job ${analysis.job_id}`
            );
          } else if (jobData.status === "failed") {
            // Job failed
            console.log(
              `Job ${analysis.job_id} failed with progress:`,
              jobData.progress
            );

            await RestaurantAnalysis.findByIdAndUpdate(analysis._id, {
              status: "failed",
              error_message: jobData.progress?.error || "Analysis failed",
              updated_at: new Date(),
            });

            console.log(
              `❌ Updated failed analysis for job ${analysis.job_id}`
            );
          } else if (
            jobData.status === "running" ||
            jobData.status === "processing"
          ) {
            // Job still running, update progress if available
            console.log(
              `⏳ Job ${analysis.job_id} still running. Progress:`,
              jobData.progress
            );

            await RestaurantAnalysis.findByIdAndUpdate(analysis._id, {
              progress: jobData.progress,
              runtime_seconds: jobData.runtime_seconds,
              updated_at: new Date(),
            });
          }
        } else {
          console.log(
            `❌ Invalid response format for job ${analysis.job_id}:`,
            statusResponse.data
          );
        }
      } catch (error) {
        console.error(
          `❌ Error updating analysis ${analysis.job_id}:`,
          error.message
        );

        if (error.response) {
          console.error(`Response status: ${error.response.status}`);
          console.error(`Response data:`, error.response.data);
        }

        // If job not found (404) or API error, mark as failed after 1 hour
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        if (analysis.created_at < oneHourAgo) {
          console.log(
            `⏰ Analysis ${analysis.job_id} is over 1 hour old, marking as failed`
          );

          await RestaurantAnalysis.findByIdAndUpdate(analysis._id, {
            status: "failed",
            error_message:
              error.response?.status === 404
                ? "Job not found on analysis server"
                : "Analysis timed out or API error",
            updated_at: new Date(),
          });
        }
      }
    }
  } catch (error) {
    console.error("❌ Error in updateRunningAnalyses job:", error);
  }
}

// Run every 30 seconds
console.log("🚀 Starting restaurant analysis update job (every 30 seconds)");
setInterval(updateRunningAnalyses, 30000);

// Also run immediately
updateRunningAnalyses();

module.exports = { updateRunningAnalyses };
