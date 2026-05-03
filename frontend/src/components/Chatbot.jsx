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
        content: "你好，我是 ParkGov Agent。我会围绕当前 AI 首选、Plan B、到场守护和外部导航，帮你判断现在去哪停更稳。",
        timestamp: new Date().toISOString(),
        suggestions: [
          '为什么推荐这里？',
          '现在过去稳不稳？',
          '为什么不是最近？',
          '有没有更稳备选？',
          '能不能预约支付？'
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
        content: '对话已清空。你可以继续问我到场保障、备选车场、导航、收费规则、缴费演示或数据来源。',
        timestamp: new Date().toISOString(),
        suggestions: [
          '为什么推荐这里？',
          '现在过去稳不稳？',
          '为什么不是最近？',
          '有没有更稳备选？',
          '能不能预约支付？'
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
          className="flex h-[min(640px,84svh)] w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-emerald-100 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-white p-4 text-zinc-950">
            <div className="flex items-center">
              <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-[0_12px_24px_rgba(16,185,129,0.22)]">
                <CpuChipIcon className="h-5 w-5" />
              </div>
                  <div>
                    <h3 className="font-semibold">ParkGov Agent</h3>
                    <p className="text-xs text-zinc-500">AI 到场保障助手</p>
                  </div>
            </div>
            <div className="flex items-center space-x-2">
              <button
                onClick={clearChat}
                className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-sm text-zinc-600 hover:bg-emerald-50 hover:text-emerald-800"
                title="清空对话"
              >
                清空
              </button>
              <button
                onClick={onClose}
                className="rounded-full border border-zinc-200 bg-white p-1 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-950"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {context?.selectedLot && (
            <div className="border-b border-emerald-100 bg-emerald-50/70 px-4 py-3 text-xs leading-5 text-emerald-950">
              <span className="font-semibold">当前关注：</span>
              {context.selectedLot.name} · 剩余 {context.selectedLot.available} · 拥挤度 {context.selectedLot.occupancy}%。
              {context.selectedLot.arrivalProbability ? ` AI 预计可停 ${context.selectedLot.arrivalProbability}%。` : ''}
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
                      ? 'bg-emerald-600 text-white'
                      : message.isError
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-zinc-50 text-zinc-900 border border-zinc-100'
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
                    <span className="text-sm">正在查找...</span>
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
                    className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-100"
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
                placeholder="问 AI 为什么推荐、稳不稳、怎么去..."
                className="flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={!inputMessage.trim() || isLoading}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
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
