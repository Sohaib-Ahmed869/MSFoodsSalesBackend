const express = require('express');
const router = express.Router();
const {
  getProductAnalytics,
  getAnalyticsProducts,
  getAnalyticsCustomers,
  getProductSalesData,
  getProductPerformanceComparison,
  getCustomers,
  getItems,
} = require('../controllers/productAnalytics.controller');

// Main analytics endpoint - comprehensive product analytics dashboard
router.get('/analytics', getProductAnalytics);

// Paginated endpoints for specific data sets
router.get('/analytics/products', getAnalyticsProducts);
router.get('/analytics/customers', getAnalyticsCustomers);

// Detailed sales data with filtering and pagination
router.get('/sales-data', getProductSalesData);

// Product performance comparison
router.get('/performance-comparison', getProductPerformanceComparison);

// Filter data endpoints
router.get('/customers', getCustomers);
router.get('/items', getItems);

module.exports = router;