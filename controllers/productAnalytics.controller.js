const Invoice = require("../models/Invoice");
const mongoose = require("mongoose");

/**
 * Get comprehensive product analytics from invoice data
 */
const getProductAnalytics = async (req, res) => {
    try {
        const {
            year,
            customer,
            product,
            sortBy = "totalRevenue",
            sortOrder = "desc",
            // Pagination parameters for products and customers
            productsPage = 1,
            productsLimit = 20,
            customersPage = 1,
            customersLimit = 20,
            productsSortBy = "totalRevenue",
            productsSortOrder = "desc",
            customersSortBy = "totalRevenue",
            customersSortOrder = "desc",
        } = req.query;

        // Build match stage for aggregation
        const matchStage = {};
        if (year && year !== "all") {
            const yearInt = parseInt(year);
            matchStage.$expr = {
                $eq: [{ $year: "$DocDate" }, yearInt]
            };
        }
        if (customer) {
            matchStage.CardCode = customer;
        }
        if (product) {
            matchStage["DocumentLines.ItemCode"] = product;
        }

        // Get KPIs
        const kpiPipeline = [
            { $match: matchStage },
            { $unwind: "$DocumentLines" },
            ...(product ? [{ $match: { "DocumentLines.ItemCode": product } }] : []),
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$DocumentLines.LineTotal" },
                    totalQuantity: { $sum: "$DocumentLines.Quantity" },
                    uniqueProducts: { $addToSet: "$DocumentLines.ItemCode" },
                    uniqueCustomers: { $addToSet: "$CardCode" },
                    totalTransactions: { $sum: 1 },
                    avgPrice: { $avg: "$DocumentLines.Price" },
                },
            },
        ];

        const kpiStats = await Invoice.aggregate(kpiPipeline);

        const kpis = kpiStats.length > 0
            ? {
                ...kpiStats[0],
                uniqueProducts: kpiStats[0].uniqueProducts.length,
                uniqueCustomers: kpiStats[0].uniqueCustomers.length,
                avgTransactionValue: kpiStats[0].totalRevenue / kpiStats[0].totalTransactions,
            }
            : {
                totalRevenue: 0,
                totalQuantity: 0,
                uniqueProducts: 0,
                uniqueCustomers: 0,
                totalTransactions: 0,
                avgTransactionValue: 0,
                avgPrice: 0,
            };

        // Get yearly trends
        const yearlyTrendsMatchStage = { ...matchStage };
        delete yearlyTrendsMatchStage.$expr; // Remove year filter for yearly trends

        const yearlyTrends = await Invoice.aggregate([
            { $match: yearlyTrendsMatchStage },
            { $unwind: "$DocumentLines" },
            ...(customer ? [] : []),
            ...(product ? [{ $match: { "DocumentLines.ItemCode": product } }] : []),
            {
                $group: {
                    _id: { $year: "$DocDate" },
                    revenue: { $sum: "$DocumentLines.LineTotal" },
                    quantity: { $sum: "$DocumentLines.Quantity" },
                    transactions: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        // Get monthly trends for current/selected year
        const selectedYear = year && year !== "all" ? parseInt(year) : new Date().getFullYear();
        const monthlyTrends = await Invoice.aggregate([
            {
                $match: {
                    $expr: { $eq: [{ $year: "$DocDate" }, selectedYear] },
                    ...(customer && { CardCode: customer }),
                },
            },
            { $unwind: "$DocumentLines" },
            ...(product ? [{ $match: { "DocumentLines.ItemCode": product } }] : []),
            {
                $group: {
                    _id: { $month: "$DocDate" },
                    revenue: { $sum: "$DocumentLines.LineTotal" },
                    quantity: { $sum: "$DocumentLines.Quantity" },
                    transactions: { $sum: 1 },
                },
            },
            { $sort: { _id: 1 } },
        ]);

        // Parse pagination parameters
        const parsedProductsPage = parseInt(productsPage) || 1;
        const parsedProductsLimit = Math.min(parseInt(productsLimit) || 20, 100);
        const parsedCustomersPage = parseInt(customersPage) || 1;
        const parsedCustomersLimit = Math.min(parseInt(customersLimit) || 20, 100);

        // Calculate skip values
        const productsSkip = (parsedProductsPage - 1) * parsedProductsLimit;
        const customersSkip = (parsedCustomersPage - 1) * parsedCustomersLimit;

        // Build sort objects
        const productsSortObj = {
            [productsSortBy]: productsSortOrder === "asc" ? 1 : -1,
        };
        const customersSortObj = {
            [customersSortBy]: customersSortOrder === "asc" ? 1 : -1,
        };

        // Get products with pagination and total count
        const productsAggregation = await Invoice.aggregate([
            { $match: matchStage },
            { $unwind: "$DocumentLines" },
            ...(product ? [{ $match: { "DocumentLines.ItemCode": product } }] : []),
            {
                $group: {
                    _id: "$DocumentLines.ItemCode",
                    itemDescription: { $first: "$DocumentLines.ItemDescription" },
                    totalRevenue: { $sum: "$DocumentLines.LineTotal" },
                    totalQuantity: { $sum: "$DocumentLines.Quantity" },
                    transactions: { $sum: 1 },
                    avgPrice: { $avg: "$DocumentLines.Price" },
                    uniqueCustomers: { $addToSet: "$CardCode" },
                },
            },
            {
                $addFields: {
                    uniqueCustomersCount: { $size: "$uniqueCustomers" },
                },
            },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [
                        { $sort: productsSortObj },
                        { $skip: productsSkip },
                        { $limit: parsedProductsLimit },
                    ],
                },
            },
        ]);

        const allProducts = productsAggregation[0].data;
        const totalProductsCount = productsAggregation[0].metadata[0]?.total || 0;
        const totalProductsPages = Math.ceil(totalProductsCount / parsedProductsLimit);

        // Get customers with pagination and total count
        const customersAggregation = await Invoice.aggregate([
            { $match: matchStage },
            { $unwind: "$DocumentLines" },
            ...(product ? [{ $match: { "DocumentLines.ItemCode": product } }] : []),
            {
                $group: {
                    _id: "$CardCode",
                    customerName: { $first: "$CardName" },
                    totalRevenue: { $sum: "$DocumentLines.LineTotal" },
                    totalQuantity: { $sum: "$DocumentLines.Quantity" },
                    transactions: { $sum: 1 },
                    avgTransactionValue: { $avg: "$DocumentLines.LineTotal" },
                    uniqueProducts: { $addToSet: "$DocumentLines.ItemCode" },
                },
            },
            {
                $addFields: {
                    uniqueProductsCount: { $size: "$uniqueProducts" },
                },
            },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [
                        { $sort: customersSortObj },
                        { $skip: customersSkip },
                        { $limit: parsedCustomersLimit },
                    ],
                },
            },
        ]);

        const allCustomers = customersAggregation[0].data;
        const totalCustomersCount = customersAggregation[0].metadata[0]?.total || 0;
        const totalCustomersPages = Math.ceil(totalCustomersCount / parsedCustomersLimit);

        // Get price distribution
        const priceDistribution = await Invoice.aggregate([
            { $match: matchStage },
            { $unwind: "$DocumentLines" },
            ...(product ? [{ $match: { "DocumentLines.ItemCode": product } }] : []),
            {
                $bucket: {
                    groupBy: "$DocumentLines.Price",
                    boundaries: [0, 10, 25, 50, 100, 250, 500, 1000],
                    default: "1000+",
                    output: {
                        count: { $sum: 1 },
                        revenue: { $sum: "$DocumentLines.LineTotal" },
                    },
                },
            },
        ]);

        // Get product category performance (assuming ItemDescription contains category info)
        const categoryPerformance = await Invoice.aggregate([
            { $match: matchStage },
            { $unwind: "$DocumentLines" },
            ...(product ? [{ $match: { "DocumentLines.ItemCode": product } }] : []),
            {
                $addFields: {
                    category: {
                        $arrayElemAt: [{ $split: ["$DocumentLines.ItemDescription", " "] }, 0],
                    },
                },
            },
            {
                $group: {
                    _id: "$category",
                    revenue: { $sum: "$DocumentLines.LineTotal" },
                    quantity: { $sum: "$DocumentLines.Quantity" },
                    transactions: { $sum: 1 },
                },
            },
            { $sort: { revenue: -1 } },
            { $limit: 8 },
        ]);

        // Get available filters
        const availableYears = await Invoice.aggregate([
            {
                $group: {
                    _id: { $year: "$DocDate" },
                },
            },
            { $sort: { _id: -1 } },
        ]);

        const availableCustomers = await Invoice.aggregate([
            {
                $group: {
                    _id: "$CardCode",
                    customerName: { $first: "$CardName" },
                },
            },
            { $sort: { customerName: 1 } },
            { $limit: 100 },
        ]);

        return res.status(200).json({
            success: true,
            data: {
                kpis,
                yearlyTrends: yearlyTrends.map((trend) => ({
                    year: trend._id,
                    revenue: trend.revenue,
                    quantity: trend.quantity,
                    transactions: trend.transactions,
                })),
                monthlyTrends: monthlyTrends.map((trend) => ({
                    month: trend._id,
                    revenue: trend.revenue,
                    quantity: trend.quantity,
                    transactions: trend.transactions,
                })),
                allProducts: {
                    data: allProducts,
                    pagination: {
                        currentPage: parsedProductsPage,
                        totalPages: totalProductsPages,
                        totalRecords: totalProductsCount,
                        hasNextPage: parsedProductsPage < totalProductsPages,
                        hasPrevPage: parsedProductsPage > 1,
                        limit: parsedProductsLimit,
                    },
                },
                allCustomers: {
                    data: allCustomers,
                    pagination: {
                        currentPage: parsedCustomersPage,
                        totalPages: totalCustomersPages,
                        totalRecords: totalCustomersCount,
                        hasNextPage: parsedCustomersPage < totalCustomersPages,
                        hasPrevPage: parsedCustomersPage > 1,
                        limit: parsedCustomersLimit,
                    },
                },
                priceDistribution,
                categoryPerformance,
                filters: {
                    availableYears: availableYears.map(y => y._id).sort((a, b) => b - a),
                    availableCustomers,
                    selectedYear: year || "all",
                    selectedCustomer: customer || null,
                },
            },
        });
    } catch (error) {
        console.error("Error fetching product analytics:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};

/**
 * Get paginated products for analytics
 */
const getAnalyticsProducts = async (req, res) => {
    try {
        const {
            year,
            customer,
            product,
            page = 1,
            limit = 20,
            sortBy = "totalRevenue",
            sortOrder = "desc",
            search,
        } = req.query;

        // Parse pagination parameters
        const parsedPage = parseInt(page) || 1;
        const parsedLimit = Math.min(parseInt(limit) || 20, 100);
        const skip = (parsedPage - 1) * parsedLimit;

        // Build match stage
        const matchStage = {};
        if (year && year !== "all") {
            matchStage.$expr = {
                $eq: [{ $year: "$DocDate" }, parseInt(year)]
            };
        }
        if (customer) {
            matchStage.CardCode = customer;
        }
        if (product) {
            matchStage["DocumentLines.ItemCode"] = product;
        }

        // Build sort object
        const sortObj = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

        // Aggregation pipeline
        let pipeline = [
            { $match: matchStage },
            { $unwind: "$DocumentLines" },
            {
                $group: {
                    _id: "$DocumentLines.ItemCode",
                    itemDescription: { $first: "$DocumentLines.ItemDescription" },
                    totalRevenue: { $sum: "$DocumentLines.LineTotal" },
                    totalQuantity: { $sum: "$DocumentLines.Quantity" },
                    transactions: { $sum: 1 },
                    avgPrice: { $avg: "$DocumentLines.Price" },
                    uniqueCustomers: { $addToSet: "$CardCode" },
                },
            },
            {
                $addFields: {
                    uniqueCustomersCount: { $size: "$uniqueCustomers" },
                },
            },
        ];

        // Add search filter if provided
        if (search) {
            pipeline.push({
                $match: {
                    $or: [
                        { itemDescription: { $regex: search, $options: "i" } },
                        { _id: { $regex: search, $options: "i" } },
                    ],
                },
            });
        }

        // Get data with pagination
        const aggregation = await Invoice.aggregate([
            ...pipeline,
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [
                        { $sort: sortObj },
                        { $skip: skip },
                        { $limit: parsedLimit },
                    ],
                },
            },
        ]);

        const products = aggregation[0].data;
        const totalCount = aggregation[0].metadata[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / parsedLimit);

        return res.status(200).json({
            success: true,
            data: {
                products,
                pagination: {
                    currentPage: parsedPage,
                    totalPages,
                    totalRecords: totalCount,
                    hasNextPage: parsedPage < totalPages,
                    hasPrevPage: parsedPage > 1,
                    limit: parsedLimit,
                },
            },
        });
    } catch (error) {
        console.error("Error fetching analytics products:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};

/**
 * Get paginated customers for analytics
 */
const getAnalyticsCustomers = async (req, res) => {
    try {
        const {
            year,
            customer,
            product,
            page = 1,
            limit = 20,
            sortBy = "totalRevenue",
            sortOrder = "desc",
            search,
        } = req.query;

        // Parse pagination parameters
        const parsedPage = parseInt(page) || 1;
        const parsedLimit = Math.min(parseInt(limit) || 20, 100);
        const skip = (parsedPage - 1) * parsedLimit;

        // Build match stage
        const matchStage = {};
        if (year && year !== "all") {
            matchStage.$expr = {
                $eq: [{ $year: "$DocDate" }, parseInt(year)]
            };
        }
        if (customer) {
            matchStage.CardCode = customer;
        }
        if (product) {
            matchStage["DocumentLines.ItemCode"] = product;
        }

        // Build sort object
        const sortObj = { [sortBy]: sortOrder === "asc" ? 1 : -1 };

        // Aggregation pipeline
        let pipeline = [
            { $match: matchStage },
            { $unwind: "$DocumentLines" },
            ...(product ? [{ $match: { "DocumentLines.ItemCode": product } }] : []),
            {
                $group: {
                    _id: "$CardCode",
                    customerName: { $first: "$CardName" },
                    totalRevenue: { $sum: "$DocumentLines.LineTotal" },
                    totalQuantity: { $sum: "$DocumentLines.Quantity" },
                    transactions: { $sum: 1 },
                    avgTransactionValue: { $avg: "$DocumentLines.LineTotal" },
                    uniqueProducts: { $addToSet: "$DocumentLines.ItemCode" },
                },
            },
            {
                $addFields: {
                    uniqueProductsCount: { $size: "$uniqueProducts" },
                },
            },
        ];

        // Add search filter if provided
        if (search) {
            pipeline.push({
                $match: {
                    $or: [
                        { customerName: { $regex: search, $options: "i" } },
                        { _id: { $regex: search, $options: "i" } },
                    ],
                },
            });
        }

        // Get data with pagination
        const aggregation = await Invoice.aggregate([
            ...pipeline,
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [
                        { $sort: sortObj },
                        { $skip: skip },
                        { $limit: parsedLimit },
                    ],
                },
            },
        ]);

        const customers = aggregation[0].data;
        const totalCount = aggregation[0].metadata[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / parsedLimit);

        return res.status(200).json({
            success: true,
            data: {
                customers,
                pagination: {
                    currentPage: parsedPage,
                    totalPages,
                    totalRecords: totalCount,
                    hasNextPage: parsedPage < totalPages,
                    hasPrevPage: parsedPage > 1,
                    limit: parsedLimit,
                },
            },
        });
    } catch (error) {
        console.error("Error fetching analytics customers:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};

/**
 * Get detailed product sales data with pagination and filtering
 */
const getProductSalesData = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const sortBy = req.query.sortBy || "totalRevenue";
        const sortOrder = req.query.sortOrder === "asc" ? 1 : -1;
        const { year, customer, product, search } = req.query;

        // Validate pagination
        if (page < 1 || limit < 1 || limit > 100) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination parameters. Page must be >= 1, limit must be between 1-100",
            });
        }

        // Build filter
        const filter = {};
        if (year && year !== "all") {
            filter.$expr = {
                $eq: [{ $year: "$DocDate" }, parseInt(year)]
            };
        }
        if (customer) {
            filter.CardCode = customer;
        }

        let pipeline = [
            { $match: filter },
            { $unwind: "$DocumentLines" },
        ];

        // Add product filter after unwind
        if (product) {
            pipeline.push({ $match: { "DocumentLines.ItemCode": product } });
        }

        // Add search filter
        if (search) {
            pipeline.push({
                $match: {
                    $or: [
                        { "DocumentLines.ItemDescription": { $regex: search, $options: "i" } },
                        { CardName: { $regex: search, $options: "i" } },
                        { CardCode: { $regex: search, $options: "i" } },
                        { "DocumentLines.ItemCode": { $regex: search, $options: "i" } },
                    ],
                },
            });
        }

        // Group by customer-product combination for detailed view
        pipeline.push({
            $group: {
                _id: {
                    customerId: "$CardCode",
                    itemId: "$DocumentLines.ItemCode",
                },
                itemId: { $first: "$DocumentLines.ItemCode" },
                itemDescription: { $first: "$DocumentLines.ItemDescription" },
                customerId: { $first: "$CardCode" },
                customerName: { $first: "$CardName" },
                totalRevenue: { $sum: "$DocumentLines.LineTotal" },
                totalQuantity: { $sum: "$DocumentLines.Quantity" },
                totalTransactions: { $sum: 1 },
                avgPrice: { $avg: "$DocumentLines.Price" },
                lastSaleDate: { $max: "$DocDate" },
                firstSaleDate: { $min: "$DocDate" },
            },
        });

        // Get total count for pagination
        const countPipeline = [...pipeline, { $count: "total" }];
        const countResult = await Invoice.aggregate(countPipeline);
        const totalCount = countResult.length > 0 ? countResult[0].total : 0;

        // Add sorting and pagination
        const sortObject = { [sortBy]: sortOrder };
        const skip = (page - 1) * limit;

        pipeline.push(
            { $sort: sortObject },
            { $skip: skip },
            { $limit: limit }
        );

        const salesData = await Invoice.aggregate(pipeline);
        const totalPages = Math.ceil(totalCount / limit);

        // Get summary for current filter
        const summaryPipeline = [
            { $match: filter },
            { $unwind: "$DocumentLines" },
            ...(product ? [{ $match: { "DocumentLines.ItemCode": product } }] : []),
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: "$DocumentLines.LineTotal" },
                    totalQuantity: { $sum: "$DocumentLines.Quantity" },
                    totalRecords: { $sum: 1 },
                },
            },
        ];

        const summary = await Invoice.aggregate(summaryPipeline);

        return res.status(200).json({
            success: true,
            data: {
                salesData,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalRecords: totalCount,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                    limit,
                },
                summary: summary.length > 0 ? summary[0] : {
                    totalRevenue: 0,
                    totalQuantity: 0,
                    totalRecords: 0,
                },
            },
        });
    } catch (error) {
        console.error("Error fetching product sales data:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};

/**
 * Get product performance comparison
 */
const getProductPerformanceComparison = async (req, res) => {
    try {
        const { productIds, year } = req.query;

        if (!productIds) {
            return res.status(400).json({
                success: false,
                message: "Product IDs are required",
            });
        }

        const productList = Array.isArray(productIds) ? productIds : productIds.split(",");

        const matchStage = {};
        if (year && year !== "all") {
            matchStage.$expr = {
                $eq: [{ $year: "$DocDate" }, parseInt(year)]
            };
        }

        const comparison = await Invoice.aggregate([
            { $match: matchStage },
            { $unwind: "$DocumentLines" },
            { $match: { "DocumentLines.ItemCode": { $in: productList } } },
            {
                $group: {
                    _id: {
                        itemId: "$DocumentLines.ItemCode",
                        year: { $year: "$DocDate" },
                    },
                    itemDescription: { $first: "$DocumentLines.ItemDescription" },
                    revenue: { $sum: "$DocumentLines.LineTotal" },
                    quantity: { $sum: "$DocumentLines.Quantity" },
                    transactions: { $sum: 1 },
                    avgPrice: { $avg: "$DocumentLines.Price" },
                },
            },
            { $sort: { "_id.year": 1, "_id.itemId": 1 } },
        ]);

        return res.status(200).json({
            success: true,
            data: comparison,
        });
    } catch (error) {
        console.error("Error fetching product performance comparison:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};

/**
 * Get customers list for filters
 */
const getCustomers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search || "";
        const skip = (page - 1) * limit;

        // Build search filter
        const searchFilter = search
            ? {
                $or: [
                    { CardName: { $regex: search, $options: "i" } },
                    { CardCode: { $regex: search, $options: "i" } },
                ],
            }
            : {};

        // Get unique customers from Invoices
        const customersAggregation = await Invoice.aggregate([
            {
                $group: {
                    _id: "$CardCode",
                    customerName: { $first: "$CardName" },
                    totalRevenue: { $sum: "$DocTotal" },
                    lastTransaction: { $max: "$DocDate" },
                },
            },
            { $match: searchFilter },
            { $sort: { customerName: 1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }],
                },
            },
        ]);

        const customers = customersAggregation[0].data;
        const totalCount = customersAggregation[0].metadata[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / limit);

        return res.status(200).json({
            success: true,
            data: {
                customers,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalRecords: totalCount,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                    limit,
                },
            },
        });
    } catch (error) {
        console.error("Error fetching customers:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch customers",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};

/**
 * Get products/items list for filters
 */
const getItems = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const search = req.query.search || "";
        const skip = (page - 1) * limit;

        // Build search filter
        const searchFilter = search
            ? {
                $or: [
                    { itemDescription: { $regex: search, $options: "i" } },
                    { itemId: { $regex: search, $options: "i" } },
                ],
            }
            : {};

        // Get unique items from Invoice DocumentLines
        const itemsAggregation = await Invoice.aggregate([
            { $unwind: "$DocumentLines" },
            {
                $group: {
                    _id: "$DocumentLines.ItemCode",
                    itemDescription: { $first: "$DocumentLines.ItemDescription" },
                    totalRevenue: { $sum: "$DocumentLines.LineTotal" },
                    totalQuantity: { $sum: "$DocumentLines.Quantity" },
                    lastTransaction: { $max: "$DocDate" },
                },
            },
            {
                $addFields: {
                    itemId: "$_id",
                },
            },
            { $match: searchFilter },
            { $sort: { itemDescription: 1 } },
            {
                $facet: {
                    metadata: [{ $count: "total" }],
                    data: [{ $skip: skip }, { $limit: limit }],
                },
            },
        ]);

        const items = itemsAggregation[0].data;
        const totalCount = itemsAggregation[0].metadata[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / limit);

        return res.status(200).json({
            success: true,
            data: {
                items,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalRecords: totalCount,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1,
                    limit,
                },
            },
        });
    } catch (error) {
        console.error("Error fetching items:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch items",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};

module.exports = {
    getProductAnalytics,
    getAnalyticsProducts,
    getAnalyticsCustomers,
    getProductSalesData,
    getProductPerformanceComparison,
    getCustomers,
    getItems,
};