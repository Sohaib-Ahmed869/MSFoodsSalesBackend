// routes/chatbot.routes.js
const express = require('express');
const router = express.Router();
const { auth, checkRole } = require('../middleware/auth');
const chatbotController = require('../controllers/chatbot.controller');

// Rate limiting middleware (optional but recommended)
const rateLimit = require('express-rate-limit');

// Create rate limiter for chatbot endpoints
const chatbotLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 30, // Limit each user to 30 requests per minute
    message: {
        success: false,
        error: 'Too many requests. Please wait a moment before trying again.'
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply rate limiting to all chatbot routes
router.use(chatbotLimiter);

// @route   POST /api/chatbot/chat
// @desc    Send message to chatbot
// @access  Private (requires authentication)
router.post('/chat', auth, chatbotController.chatWithBot);

// @route   GET /api/chatbot/status
// @desc    Get documentation loading status
// @access  Private
router.get('/status', auth, chatbotController.getDocumentationStatus);

// @route   POST /api/chatbot/reload
// @desc    Reload documentation files (admin only)
// @access  Private (admin only)
router.post('/reload', auth, checkRole(['admin']), chatbotController.reloadDocumentation);

// @route   GET /api/chatbot/topics
// @desc    Get available topics based on user role
// @access  Private
router.get('/topics', auth, chatbotController.getAvailableTopics);

// @route   POST /api/chatbot/conversation/start
// @desc    Start a new conversation
// @access  Private
router.post('/conversation/start', auth, chatbotController.startConversation);

// @route   GET /api/chatbot/conversation/:conversationId
// @desc    Get conversation history
// @access  Private
router.get('/conversation/:conversationId', auth, chatbotController.getConversation);

module.exports = router;