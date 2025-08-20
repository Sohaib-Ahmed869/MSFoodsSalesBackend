// controllers/chatbot.controller.js
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const axios = require('axios');

// Store processed documentation in memory (you could use a database instead)
let documentationData = {
    admin: '',
    agent: '',
    manager: '',
    lastUpdated: null
};

// OpenAI configuration
const OPENAI_API_KEY = process.env.NEW_OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// Load and process documentation files
const loadDocumentation = async () => {
    try {
        const documentsPath = path.join(process.cwd(), 'documents');

        // Check if documents directory exists
        if (!fs.existsSync(documentsPath)) {
            console.error('Documents directory not found');
            return;
        }

        // File mappings
        const files = {
            admin: 'Admin Manual.docx',
            agent: 'Agent Manual.docx',
            manager: 'Manager Manual.docx'
        };

        // Process each documentation file
        for (const [type, filename] of Object.entries(files)) {
            const filePath = path.join(documentsPath, filename);

            if (fs.existsSync(filePath)) {
                console.log(`Processing ${type} documentation: ${filename}`);

                // Extract text from DOCX
                const result = await mammoth.extractRawText({ path: filePath });
                documentationData[type] = result.value;

                console.log(`Loaded ${type} documentation (${result.value.length} characters)`);
            } else {
                console.warn(`Documentation file not found: ${filePath}`);
            }
        }

        documentationData.lastUpdated = new Date();
        console.log('Documentation loading completed');

    } catch (error) {
        console.error('Error loading documentation:', error);
    }
};

// Initialize documentation on startup
loadDocumentation();

// Helper function to determine user role context
const getUserRoleContext = (userRole) => {
    const roleMap = {
        'admin': 'admin',
        'sales_manager': 'manager',
        'sales_agent': 'agent'
    };
    return roleMap[userRole] || 'admin';
};

// Helper function to create context-aware prompt
const createChatPrompt = (question, userRole, conversationHistory = []) => {
    const roleContext = getUserRoleContext(userRole);
    const relevantDocs = documentationData[roleContext] || documentationData.admin;

    // Include all documentation for comprehensive answers, but prioritize user's role
    const allDocs = `
ADMIN DOCUMENTATION:
${documentationData.admin}

SALES MANAGER DOCUMENTATION:
${documentationData.manager}

SALES AGENT DOCUMENTATION:
${documentationData.agent}
  `;

    let conversationContext = '';
    if (conversationHistory.length > 0) {
        conversationContext = '\n\nPREVIOUS CONVERSATION:\n' +
            conversationHistory.slice(-4).map(msg =>
                `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`
            ).join('\n');
    }

    return `You are a helpful assistant for the HFS (Halal Foods Services) system. You have access to comprehensive documentation for admins, sales managers, and sales agents.

The user asking this question has the role: ${userRole.toUpperCase()}

Please answer their question based on the documentation provided. Give clear, step-by-step instructions when appropriate. If the question is specific to their role, prioritize information relevant to their role, but you can reference other roles' capabilities when helpful.

DOCUMENTATION:
${allDocs}

${conversationContext}

USER QUESTION: ${question}

Please provide a helpful, accurate answer based on the documentation. If you cannot find the specific information in the documentation, say so clearly.`;
};

// Main chatbot controller
exports.chatWithBot = async (req, res) => {
    try {
        const { message, conversationHistory = [] } = req.body;
        const userRole = req.user?.role || 'admin';

        // Validate input
        if (!message || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }

        // Check if OpenAI API key is configured
        if (!OPENAI_API_KEY) {
            return res.status(500).json({
                success: false,
                error: 'OpenAI API key not configured'
            });
        }

        // Check if documentation is loaded
        if (!documentationData.admin && !documentationData.manager && !documentationData.agent) {
            return res.status(500).json({
                success: false,
                error: 'Documentation not loaded. Please try again later.'
            });
        }

        console.log(`Chatbot query from ${userRole}: ${message.substring(0, 100)}...`);

        // Create the prompt with context
        const prompt = createChatPrompt(message, userRole, conversationHistory);

        // Call OpenAI API
        const response = await axios.post(
            OPENAI_API_URL,
            {
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: prompt
                    }
                ],
                max_tokens: 1000,
                temperature: 0.3,
                presence_penalty: 0.1,
                frequency_penalty: 0.1
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 second timeout
            }
        );

        const botResponse = response.data.choices[0].message.content;

        // Log successful interaction
        console.log(`Chatbot response generated (${botResponse.length} characters)`);

        res.json({
            success: true,
            response: botResponse,
            userRole: userRole,
            timestamp: new Date(),
            conversationId: req.body.conversationId || null
        });

    } catch (error) {
        console.error('Chatbot error:', error);

        // Handle specific OpenAI errors
        if (error.response?.status === 401) {
            return res.status(500).json({
                success: false,
                error: 'OpenAI API authentication failed'
            });
        }

        if (error.response?.status === 429) {
            return res.status(429).json({
                success: false,
                error: 'Rate limit exceeded. Please try again later.'
            });
        }

        if (error.code === 'ECONNABORTED') {
            return res.status(408).json({
                success: false,
                error: 'Request timeout. Please try again.'
            });
        }

        res.status(500).json({
            success: false,
            error: 'An error occurred while processing your request',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get documentation status
exports.getDocumentationStatus = async (req, res) => {
    try {
        const status = {
            admin: {
                loaded: !!documentationData.admin,
                size: documentationData.admin?.length || 0
            },
            manager: {
                loaded: !!documentationData.manager,
                size: documentationData.manager?.length || 0
            },
            agent: {
                loaded: !!documentationData.agent,
                size: documentationData.agent?.length || 0
            },
            lastUpdated: documentationData.lastUpdated
        };

        res.json({
            success: true,
            status
        });
    } catch (error) {
        console.error('Error getting documentation status:', error);
        res.status(500).json({
            success: false,
            error: 'Error retrieving documentation status'
        });
    }
};

// Reload documentation (admin only)
exports.reloadDocumentation = async (req, res) => {
    try {
        // Check if user is admin
        if (req.user?.role !== 'admin') {
            return res.status(403).json({
                success: false,
                error: 'Only admins can reload documentation'
            });
        }

        console.log('Reloading documentation...');
        await loadDocumentation();

        res.json({
            success: true,
            message: 'Documentation reloaded successfully',
            lastUpdated: documentationData.lastUpdated
        });
    } catch (error) {
        console.error('Error reloading documentation:', error);
        res.status(500).json({
            success: false,
            error: 'Error reloading documentation'
        });
    }
};

// Get available features/topics from documentation
exports.getAvailableTopics = async (req, res) => {
    try {
        const userRole = req.user?.role || 'admin';
        const roleContext = getUserRoleContext(userRole);

        // Extract main topics from documentation (simplified approach)
        const topics = [];

        if (userRole === 'admin' || userRole === 'sales_manager') {
            topics.push(
                'Customer Management',
                'Sales Agent Management',
                'Reports and Analytics',
                'User Profile Management',
                'Call Analytics',
                'Team Performance',
                'Quotation Management',
                'Task Management'
            );
        }

        if (userRole === 'sales_agent') {
            topics.push(
                'Customer Management',
                'Profile Management',
                'Creating Quotations',
                'Order Placement',
                'Task Management',
                'Call Logs',
                'Sales Targets'
            );
        }

        // Common topics for all roles
        topics.push(
            'Password Management',
            'Navigation',
            'Basic System Usage'
        );

        res.json({
            success: true,
            topics: [...new Set(topics)], // Remove duplicates
            userRole
        });
    } catch (error) {
        console.error('Error getting available topics:', error);
        res.status(500).json({
            success: false,
            error: 'Error retrieving available topics'
        });
    }
};

// Conversation management (simple in-memory storage)
const conversations = new Map();

// Start a new conversation
exports.startConversation = async (req, res) => {
    try {
        const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const userRole = req.user?.role || 'admin';

        conversations.set(conversationId, {
            id: conversationId,
            userId: req.user?._id,
            userRole,
            messages: [],
            createdAt: new Date(),
            lastActivity: new Date()
        });

        res.json({
            success: true,
            conversationId,
            message: 'New conversation started'
        });
    } catch (error) {
        console.error('Error starting conversation:', error);
        res.status(500).json({
            success: false,
            error: 'Error starting conversation'
        });
    }
};

// Get conversation history
exports.getConversation = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const conversation = conversations.get(conversationId);

        if (!conversation) {
            return res.status(404).json({
                success: false,
                error: 'Conversation not found'
            });
        }

        // Check if user owns this conversation
        if (conversation.userId !== req.user?._id?.toString()) {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        res.json({
            success: true,
            conversation: {
                id: conversation.id,
                messages: conversation.messages,
                createdAt: conversation.createdAt,
                lastActivity: conversation.lastActivity
            }
        });
    } catch (error) {
        console.error('Error getting conversation:', error);
        res.status(500).json({
            success: false,
            error: 'Error retrieving conversation'
        });
    }
};

module.exports = exports;