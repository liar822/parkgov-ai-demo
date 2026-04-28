import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  XMarkIcon, 
  PaperAirplaneIcon,
  UserIcon,
  CpuChipIcon
} from '@heroicons/react/24/outline';
import { chatbotService } from '../services/api';
import LoadingSpinner from './LoadingSpinner';
import { formatTime } from '../utils/dateUtils';

const Chatbot = ({ isOpen, onClose, context = null }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [previousIntent, setPreviousIntent] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Initial welcome message
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      const welcomeMessage = {
        id: Date.now(),
        type: 'bot',
        content: "你好，我是 ParkGov Agent。可以帮你找更合适的停车场、解释推荐分流理由、说明和高德停车的差异，也会提醒哪些内容只是 demo 或公开数据样例。",
        timestamp: new Date().toISOString(),
        suggestions: [
          '哪里还有车位？',
          '怎么导航过去？',
          '为什么不是最近的？',
          '和高德停车有什么不同？',
          '这些数据来源是什么？',
          '有没有更便宜的？'
        ]
      };
      setMessages([welcomeMessage]);
      setSuggestions(welcomeMessage.suggestions);
    }
  }, [isOpen, messages.length]);

  // Auto-scroll to bottom
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = async (messageText = null) => {
    const text = messageText || inputMessage.trim();
    if (!text || isLoading) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsLoading(true);
    setSuggestions([]);

    try {
      // Add previous intent to context for conversation flow
      const chatContext = {
        ...context,
        previousIntent
      };
      
      const response = await chatbotService.sendMessage(text, chatContext);
      
      if (response.data.success) {
        const botMessage = {
          id: Date.now() + 1,
          type: 'bot',
          content: response.data.response,
          timestamp: new Date().toISOString(),
          intent: response.data.intent,
          confidence: response.data.confidence
        };

        setMessages(prev => [...prev, botMessage]);

        // Update previous intent for next message
        setPreviousIntent(response.data.intent);

        // Get suggestions based on intent
        if (response.data.intent) {
          try {
            const suggestionsResponse = await chatbotService.getSuggestions(response.data.intent);
            if (suggestionsResponse.data.success) {
              setSuggestions(suggestionsResponse.data.suggestions || []);
            }
          } catch (error) {
            console.error('Error getting suggestions:', error);
          }
        }
      } else {
        throw new Error(response.data.error || 'Failed to get response');
      }
    } catch (error) {
      console.error('Chatbot error:', error);
      const errorMessage = {
        id: Date.now() + 1,
        type: 'bot',
        content: '我暂时无法处理这条问题。你可以先查看停车场列表和详情抽屉；当前智能体仍是演示能力，不影响余位页面使用。',
        timestamp: new Date().toISOString(),
        isError: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    sendMessage();
  };

  const handleSuggestionClick = (suggestion) => {
    sendMessage(suggestion);
  };

  const clearChat = () => {
    setMessages([]);
    setSuggestions([]);
    // Re-add welcome message
    setTimeout(() => {
      const welcomeMessage = {
        id: Date.now(),
        type: 'bot',
        content: '对话已清空。你可以继续问我余位、推荐理由、和高德的差异、收费规则或数据来源。',
        timestamp: new Date().toISOString(),
        suggestions: [
          '哪里还有车位？',
          '怎么导航过去？',
          '为什么推荐这里？',
          '和高德有什么区别？',
          '收费规则是什么？',
          '说明演示边界'
        ]
      };
      setMessages([welcomeMessage]);
      setSuggestions(welcomeMessage.suggestions);
    }, 100);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-end bg-zinc-950/35 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="flex h-[min(620px,82svh)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 p-4 text-white">
            <div className="flex items-center">
              <div className="mr-3 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400 text-zinc-950">
                <CpuChipIcon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold">ParkGov Agent</h3>
                <p className="text-xs text-zinc-300">停车服务与治理演示智能体</p>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={clearChat}
                className="rounded px-2 py-1 text-sm text-zinc-300 hover:text-white"
                title="清空对话"
              >
                清空
              </button>
              <button
                onClick={onClose}
                className="rounded p-1 text-zinc-300 hover:text-white"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {context?.selectedLot && (
            <div className="border-b border-zinc-100 bg-emerald-50 px-4 py-3 text-xs leading-5 text-emerald-900">
              正在围绕 <span className="font-semibold">{context.selectedLot.name}</span> 解答：
              剩余 {context.selectedLot.available} 个车位，拥挤度 {context.selectedLot.occupancy}%。
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                    message.type === 'user'
                      ? 'bg-zinc-950 text-white'
                      : message.isError
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-zinc-100 text-zinc-900'
                  }`}
                >
                  <div className="flex items-start">
                    {message.type === 'bot' && (
                      <div className="mt-0.5 mr-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                        <CpuChipIcon className="h-3 w-3 text-emerald-700" />
                      </div>
                    )}
                    {message.type === 'user' && (
                      <div className="mt-0.5 mr-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-zinc-800">
                        <UserIcon className="h-3 w-3 text-white" />
                      </div>
                    )}
                    <div className="flex-1">
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                      <p className="text-xs opacity-70 mt-1">
                        {formatTime(message.timestamp)}
                      </p>
                      {message.confidence && (
                        <p className="text-xs opacity-50 mt-1">
                          意图置信度：{Math.round(message.confidence * 100)}%
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="max-w-xs rounded-lg bg-zinc-100 px-4 py-2 text-zinc-900">
                  <div className="flex items-center">
                    <div className="mr-2 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                      <CpuChipIcon className="h-3 w-3 text-emerald-700" />
                    </div>
                    <LoadingSpinner size="small" className="mr-2" />
                    <span className="text-sm">正在研判...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && !isLoading && (
            <div className="border-t border-zinc-100 px-4 py-2">
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="rounded-full bg-zinc-100 px-3 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-200"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="border-t border-zinc-200 p-4">
            <form onSubmit={handleSubmit} className="flex space-x-2">
              <input
                ref={inputRef}
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                placeholder="问我余位、收费、推荐理由或数据来源..."
                className="flex-1 form-input text-sm"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || isLoading}
                className="inline-flex items-center justify-center rounded-md bg-zinc-950 p-2 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PaperAirplaneIcon className="w-4 h-4" />
              </button>
            </form>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default Chatbot;
