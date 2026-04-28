const express = require('express');
const router = express.Router();
const ChatbotController = require('../controllers/chatbotController');

// Chatbot routes
router.post('/query', ChatbotController.sendMessage);
router.get('/suggestions/:intent', ChatbotController.getSuggestions);
router.get('/history/:sessionId', ChatbotController.getConversationHistory);

module.exports = router;
