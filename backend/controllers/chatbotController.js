const db = require('../config/database');
const Joi = require('joi');

// Validation schema
const sendMessageSchema = Joi.object({
  message: Joi.string().required(),
  context: Joi.object().optional(),
  timestamp: Joi.string().isoDate().optional()
});

class ChatbotController {
  // Send message to chatbot
  static async sendMessage(req, res) {
    try {
      const { error, value } = sendMessageSchema.validate(req.body);
      if (error) {
        return res.status(400).json({
          success: false,
          error: 'Validation error',
          details: error.details[0].message
        });
      }

      const { message, context } = value;

      // Get previous intent from context for conversation flow
      const previousIntent = context?.previousIntent || null;
      
      // Analyze user intent
      const intent = ChatbotController.analyzeIntent(message, previousIntent);
      
      // Generate response based on intent
      const response = await ChatbotController.generateResponse(intent, message, context);

      // Save conversation to database (optional)
      try {
        await ChatbotController.saveConversation(req, message, response, intent);
      } catch (saveError) {
        console.error('Error saving conversation:', saveError.message);
        // Don't fail the request if save fails
      }

      res.json({
        success: true,
        response: response.text,
        intent: intent.name,
        confidence: intent.confidence,
        entities: intent.entities
      });
    } catch (error) {
      console.error('Error in chatbot:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to process message',
        message: error.message
      });
    }
  }

  // Get suggestions based on intent
  static async getSuggestions(req, res) {
    try {
      const { intent } = req.params;

      const suggestions = ChatbotController.getIntentSuggestions(intent);

      res.json({
        success: true,
        suggestions
      });
    } catch (error) {
      console.error('Error getting suggestions:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get suggestions',
        message: error.message
      });
    }
  }

  // Get conversation history
  static async getConversationHistory(req, res) {
    try {
      const { sessionId } = req.params;
      const limit = parseInt(req.query.limit) || 20;

      const query = `
        SELECT 
          id,
          user_message,
          bot_response,
          intent,
          confidence,
          created_at
        FROM chatbot_conversations
        WHERE session_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;

      const result = await db.query(query, [sessionId, limit]);
      const conversations = result.rows.reverse();

      res.json({
        success: true,
        conversations,
        count: conversations.length
      });
    } catch (error) {
      console.error('Error getting conversation history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get conversation history',
        message: error.message
      });
    }
  }

  // Analyze user intent from message
  static analyzeIntent(message, previousIntent = null) {
    const lowerMessage = message.toLowerCase();
    
    // Check for conversational responses first
    const conversationalResponses = this.detectConversationalResponse(lowerMessage, previousIntent);
    if (conversationalResponses) {
      return conversationalResponses;
    }
    
    const intents = [
      {
        name: 'arrival_assurance',
        keywords: ['arrival', 'risk', 'backup', 'alternative', 'arrive', 'plan b', 'planb', '到场', '还有位', '风险', '备选', '到场码', '到场计划', '现在过去', '稳不稳', '稳吗'],
        patterns: [/现在.*过去.*有.*位/, /到.*还有.*位/, /为什么.*风险.*高/, /有没有.*备选/, /有没有.*plan\s*b/i, /到场码.*用/, /到场.*计划/],
        entities: ['lot_name']
      },
      {
        name: 'find_parking',
        keywords: ['find', 'available', 'vacant', 'empty', 'search', 'look for', 'where', 'yes', 'sure', 'ok', 'okay', '车位', '停车', '哪里', '去哪', '推荐', '空位', '余位'],
        patterns: [/find.*parking/, /available.*slot/, /where.*park/, /^(yes|yeah|sure|ok|okay)$/, /哪里.*停/, /推荐.*停车/, /还有.*车位/],
        entities: ['location', 'time']
      },
      {
        name: 'recommendation_logic',
        keywords: ['why', 'recommendation', 'score', 'nearest', 'closest', 'logic', '为什么', '推荐理由', '推荐分', '最近', '分流', '压力', '算法'],
        patterns: [/why.*recommend/, /why.*not.*nearest/, /recommend.*score/, /为什么.*推荐/, /为什么.*不是.*最近/, /推荐.*逻辑/, /分流.*推荐/],
        entities: ['lot_name']
      },
      {
        name: 'gaode_difference',
        keywords: ['gaode', 'amap', 'map app', 'difference', 'competitor', '高德', '地图', '区别', '差异', '百度地图', '导航软件'],
        patterns: [/高德.*区别/, /和.*高德.*不同/, /不是.*高德/, /difference.*gaode/, /compare.*amap/],
        entities: []
      },
      {
        name: 'check_pricing',
        keywords: ['cost', 'price', 'rate', 'fee', 'charge', 'how much', 'pricing', 'cheap', 'cheapest', '收费', '费用', '价格', '多少钱', '费率', '便宜', '最便宜', '低价'],
        patterns: [/how much.*cost/, /what.*price/, /rate.*hour/, /cheapest.*parking/, /收费.*多少/, /多少钱/, /费用.*规则/, /有没有.*便宜/, /最便宜/],
        entities: ['duration', 'vehicle_type']
      },
      {
        name: 'check_occupancy',
        keywords: ['occupancy', 'busy', 'crowded', 'full', 'capacity', 'availability', '拥挤', '忙', '满', '占用', '利用率', '空闲'],
        patterns: [/how.*busy/, /occupancy.*rate/, /many.*spots/, /拥挤.*吗/, /占用率/, /满.*了/],
        entities: ['time_range', 'lot_name']
      },
      {
        name: 'get_directions',
        keywords: ['direction', 'location', 'address', 'where', 'get to', 'navigate', '导航', '路线', '地址', '位置', '坐标', '怎么去'],
        patterns: [/how.*get.*to/, /where.*located/, /direction.*to/, /怎么.*去/, /能.*导航/, /路线/],
        entities: ['destination']
      },
      {
        name: 'booking_help',
        keywords: ['book', 'reserve', 'reservation', 'hold', 'save', '预约', '预订', '占位', '保留'],
        patterns: [/how.*book/, /can.*reserve/, /want.*to book/, /能.*预约/, /可以.*预订/],
        entities: ['time', 'duration']
      },
      {
        name: 'release_slot',
        keywords: ['release', 'leave', 'exit', 'check out', 'finish'],
        patterns: [/how.*release/, /need.*to leave/, /done.*parking/],
        entities: ['slot_number']
      },
      {
        name: 'hours_of_operation',
        keywords: ['open', 'close', 'hours', 'time', 'schedule', 'when'],
        patterns: [/what.*hours/, /when.*open/, /closing.*time/],
        entities: ['day']
      },
      {
        name: 'payment_methods',
        keywords: ['pay', 'payment', 'card', 'cash', 'method', 'accept', '支付', '付款', '缴费', '现金', '扫码'],
        patterns: [/what.*payment/, /can.*pay.*with/, /do.*accept/, /怎么.*支付/, /能.*缴费/],
        entities: []
      },
      {
        name: 'data_source',
        keywords: ['data', 'source', 'real', 'demo', 'dataset', '数据', '来源', '真实', '边界', '样例', '公开数据', 'osm', '摄像头'],
        patterns: [/数据.*来源/, /是否.*真实/, /真实.*摄像头/, /demo.*数据/, /开放数据/],
        entities: []
      },
      {
        name: 'support',
        keywords: ['help', 'support', 'contact', 'problem', 'issue', 'wrong'],
        patterns: [/i need.*help/, /have.*problem/, /contact.*support/],
        entities: ['issue_type']
      },
      {
        name: 'general',
        keywords: [],
        patterns: [],
        entities: []
      }
    ];

    // Calculate scores for each intent
    const scoredIntents = intents.map(intent => {
      let score = 0;

      // Check keyword matches
      intent.keywords.forEach(keyword => {
        if (lowerMessage.includes(keyword)) {
          score += 2;
        }
      });

      // Check pattern matches
      intent.patterns.forEach(pattern => {
        if (pattern.test(lowerMessage)) {
          score += 5;
        }
      });

      return {
        name: intent.name,
        score,
        confidence: Math.min(score / 10, 1),
        entities: intent.entities
      };
    });

    // Sort by score and get best match
    scoredIntents.sort((a, b) => b.score - a.score);
    const bestMatch = scoredIntents[0];

    // Extract entities (simple implementation)
    const entities = ChatbotController.extractEntities(message, bestMatch.name);

    return {
      ...bestMatch,
      entities
    };
  }

  // Detect conversational responses (yes, no, thanks, etc.)
  static detectConversationalResponse(message, previousIntent) {
    const positiveResponses = ['yes', 'yeah', 'sure', 'ok', 'okay', 'yep', 'absolutely', 'definitely', 'please', 'pls', '好', '可以', '是的', '继续', '要'];
    const negativeResponses = ['no', 'nope', 'nah', 'not really', 'never mind', '不用', '不要', '算了'];
    const thanksResponses = ['thanks', 'thank you', 'thx', 'appreciate it', '谢谢', '多谢'];
    
    if (positiveResponses.includes(message)) {
      // If user says yes to a follow-up question, continue the previous intent
      if (previousIntent === 'find_parking') {
        return {
          name: 'show_availability',
          keywords: [],
          score: 10,
          confidence: 0.95,
          entities: {}
        };
      }
      if (previousIntent === 'check_pricing') {
        return {
          name: 'pricing_details',
          keywords: [],
          score: 10,
          confidence: 0.95,
          entities: {}
        };
      }
      // Default to continuing previous intent
      return {
        name: previousIntent || 'general',
        keywords: [],
        score: 10,
        confidence: 0.9,
        entities: {}
      };
    }
    
    if (negativeResponses.includes(message)) {
      return {
        name: 'decline_offer',
        keywords: [],
        score: 10,
        confidence: 0.9,
        entities: {}
      };
    }
    
    if (thanksResponses.includes(message)) {
      return {
        name: 'gratitude',
        keywords: [],
        score: 10,
        confidence: 0.95,
        entities: {}
      };
    }
    
    return null;
  }

  // Extract entities from message
  static extractEntities(message, intent) {
    const entities = {};
    const lowerMessage = message.toLowerCase();

    // Extract time-related entities
    const timePatterns = [
      /\b(\d+)\s*(am|pm)\b/g,
      /\b(morning|afternoon|evening|night)\b/g,
      /\b(today|tomorrow|now)\b/g,
      /\b(\d+)\s*(hour|minute)s?\b/g
    ];

    timePatterns.forEach(pattern => {
      const matches = lowerMessage.match(pattern);
      if (matches) {
        entities.time = matches;
      }
    });

    // Extract location entities
    const locationPatterns = [
      /\b(lot\s*\w+|parking\s*\w+)\b/gi
    ];

    locationPatterns.forEach(pattern => {
      const matches = lowerMessage.match(pattern);
      if (matches) {
        entities.location = matches;
      }
    });

    return entities;
  }

  // Generate response based on intent
  static async generateResponse(intent, message, context) {
    const summary = context?.summary || {};
    const selectedLot = context?.selectedLot || null;
    const recommendedLot = context?.recommendedLot || null;
    const alternatives = Array.isArray(context?.alternatives) ? context.alternatives : [];
    const activeArrivalIntent = context?.activeArrivalIntent || null;
    const activeLot = selectedLot || recommendedLot;
    const alternativeLine = alternatives.length > 0
      ? alternatives.slice(0, 2).map((lot) => `${lot.rank || 'Plan'}：${lot.name}，剩余 ${lot.available ?? '--'} 个，可停 ${lot.arrivalProbability ?? '--'}%，距离 ${lot.distance || '待核验'}`).join('\n')
      : '当前还没有明确 Plan B。可以先查看页面里的 AI 推荐卡或地图备选点。';
    const lotLine = (lot) => {
      if (!lot) return '当前还没有选中的停车场。';
      return `${lot.name}：剩余 ${lot.available ?? '未知'} / ${lot.total ?? '未知'} 个车位，占用率 ${lot.occupancy ?? '未知'}%，距离 ${lot.distance || '待核验'}，来源为 ${lot.sourceLabel || lot.sourceType || '演示数据'}。`;
    };
    const boundary = '当前是 ParkGov AI 演示智能体：数据来自校园试点 demo、北京开放数据样例、OSM 候选和 AI 数据集验证，不代表全北京实时摄像头接入，也不提供真实预约、支付或车位锁定。';

    const responses = {
      find_parking: {
        text: recommendedLot
          ? `我建议先看“${recommendedLot.name}”。\n\n${lotLine(recommendedLot)}\n推荐依据：${recommendedLot.reason || '综合余位、距离、拥挤度、收费完整度和数据来源计算'}。\n\n${boundary}`
          : `当前列表里暂时没有可推荐停车场。可以尝试清空搜索条件或切换数据来源。\n\n${boundary}`,
        actions: ['show_availability', 'view_map']
      },
      arrival_assurance: {
        text: activeLot
          ? `按当前演示数据看，${activeLot.name} 的到场判断如下：\n\n${lotLine(activeLot)}\n可停概率：${activeLot.arrivalProbability ?? '待计算'}%，到场风险：${activeLot.arrivalRisk || '待判断'}，预计到达：${activeLot.arrivalEtaMinutes ? `${activeLot.arrivalEtaMinutes} 分钟` : '待核验'}。\n\n备选方案：\n${alternativeLine}\n\n${activeArrivalIntent ? `当前到场码 ${activeArrivalIntent.code}：可停概率 ${activeArrivalIntent.currentProbability ?? '待同步'}%，余位较生成时变化 ${activeArrivalIntent.availableDelta ?? '--'}；${activeArrivalIntent.shouldSwitch ? `建议查看备选 ${activeArrivalIntent.suggestedLot || 'Plan B'}。` : '暂不需要切换备选。'}\n\n` : ''}如果风险偏高，建议优先看页面里的 Plan B / Plan C 备选停车场。到场码只是演示凭证：不锁位、不扣款、不代表真实预约，用来展示“行前决策 + 到场凭证 + 后台可追踪”的闭环。\n\n${boundary}`
          : `到场保障回答的是“我现在过去，到那儿还有没有位”。页面会综合余位、距离、数据新鲜度、AI/开放数据来源和坐标完整度，给出可停概率、风险和备选方案。\n\n${boundary}`,
        actions: ['view_arrival_plan', 'view_backup_lots']
      },
      show_availability: {
        text: `当前演示范围内共有 ${summary.totalLots ?? '若干'} 个停车场、${summary.totalSpaces ?? '若干'} 个车位，剩余 ${summary.availableSpaces ?? '若干'} 个车位，平均占用约 ${summary.averageOccupancy ?? '未知'}%。\n\n${lotLine(activeLot)}\n\n建议优先选择余位充足、占用率较低、收费规则明确且坐标已核验的停车场。`,
        actions: ['view_detailed_availability', 'view_map']
      },
      check_pricing: {
        text: activeLot
          ? `“${activeLot.name}”的收费信息：${activeLot.feeRule || '暂无收费标准'}。\n\nParkGov AI 会展示收费透明度，但不会把“最低价”作为唯一目标。当前推荐优先级是：可停概率、少绕路、分散拥挤压力，再把收费规则作为辅助决策因子。`
          : '当前没有选中停车场。你可以先点选一个停车场详情，再查看收费规则。当前 MVP 不承诺全域最低价，只做收费规则展示和后续接入预留。',
        actions: ['view_pricing_details']
      },
      recommendation_logic: {
        text: activeLot
          ? `推荐逻辑不是简单选择最近停车场。\n\n${lotLine(activeLot)}\n推荐依据：${activeLot.reason || '综合余位保障、距离便利、拥挤缓解和数据可信度'}。\n\n如果最近点接近满位，系统会优先提示余位更稳、占用率更低的备选，用于减少绕行和局部拥堵。收费信息会展示，但不是唯一排序目标。`
          : `推荐逻辑由四类因素构成：余位保障、距离便利、拥挤缓解、数据可信。它服务于“方便停车 + 分散压力”，不是只找最近或最低价。\n\n${boundary}`,
        actions: ['view_recommendation_score']
      },
      gaode_difference: {
        text: `可以这样理解：高德停车更偏“地图导航入口”，擅长 POI、路线、导航和部分停车服务跳转；ParkGov AI 的重点是“AI 车位感知 + 可解释分流推荐 + 治理研判”。\n\n算法层面：我们强调余位、占用率、来源可信度和分流推荐，不只是最近距离。\n用户层面：我们回答“现在更适合去哪儿停，为什么”。\n治理层面：我们给管理端和治理端看 ROI 覆盖、AI 事件、区域占用和候选资源核验。\n\n${boundary}`,
        actions: ['view_governance']
      },
      pricing_details: {
        text: activeLot
          ? `收费规则以当前数据源字段为准：${activeLot.feeRule || '暂无收费标准'}。\n\n本系统目前只展示收费信息，不做线上支付、计费结算或预约扣费。正式接入前需要核验数据来源、更新时间和收费口径。`
          : `当前没有选中停车场。${boundary}`,
        actions: ['view_discounts']
      },
      check_occupancy: {
        text: activeLot
          ? `当前选中停车场状态：${lotLine(activeLot)}\n\n如果占用率高于 75%，页面会标记为较忙或紧张；如果高于 90%，建议优先查看备选停车场。`
          : `当前演示范围平均占用约 ${summary.averageOccupancy ?? '未知'}%，偏紧张停车场 ${summary.busyLots ?? 0} 个。`,
        actions: ['view_occupancy_chart', 'set_availability_alert']
      },
      get_directions: {
        text: activeLot
          ? `${activeLot.navigationAvailable ? '当前可以通过页面里的“去导航”按钮跳转到外部地图。' : '当前停车场坐标待核验，页面不会生成外部地图导航。'}\n\n${lotLine(activeLot)}\n地址：${activeLot.address || '暂无地址'}。\n\nParkGov AI 只做外部地图跳转，不请求浏览器定位，不做站内路线规划，也不提供预约、支付或车位锁定。`
          : `当前没有选中停车场。${boundary}`,
        actions: ['open_maps', 'show_directions']
      },
      booking_help: {
        text: `当前 MVP 不提供真实预约或占位功能，只展示余位、推荐、收费和数据来源。后续如果做校园试点预约，需要补充账号权限、预约规则、超时释放和管理端审核流程。\n\n${boundary}`,
        actions: ['start_booking', 'view_booked_slots']
      },
      release_slot: {
        text: '当前没有真实预约和释放车位流程。管理端可以通过 AI 识别事件或 demo 数据更新车位占用状态，用户端只展示结果。',
        actions: ['go_to_bookings', 'confirm_release']
      },
      hours_of_operation: {
        text: activeLot
          ? '开放时间字段当前未作为统一必填项。你可以先参考停车场详情中的地址、来源和备注；正式校园试点需要由管理方补充开放时段。'
          : '当前没有统一开放时间数据。正式上线前需要从校园停车规则或官方开放数据补齐。',
        actions: []
      },
      payment_methods: {
        text: `当前不接支付，不采集车牌、手机号或支付信息。页面只展示收费规则字段，避免把演示系统误解为真实缴费平台。\n\n${boundary}`,
        actions: ['update_payment_method']
      },
      data_source: {
        text: `数据来源说明：\n1. 校园试点 demo：用于展示高校场景的字段和流程。\n2. 北京开放数据样例：用于适配公共停车数据结构，当前不是全量实时接入。\n3. OSM/Overpass 候选：用于停车资源空间初筛，需人工核验并遵循 ODbL 署名。\n4. AI 数据集验证：用于验证车位识别和写回链路，不代表真实停车场实时余位。\n\n${boundary}`,
        actions: ['view_sources']
      },
      support: {
        text: '如果演示页面异常，可以先检查：后端 API 是否运行、停车场列表是否返回、地图底图是否可访问、是否选择了有坐标的停车场。正式对外展示前建议使用稳定部署链接和预置 demo 数据。',
        actions: ['contact_support', 'view_faq']
      },
      general: {
        text: `我是 ParkGov Agent，可以帮你解释当前停车推荐、余位状态、收费规则、地图点位和数据来源。\n\n${activeLot ? `当前选中：${lotLine(activeLot)}\n\n` : ''}${boundary}`,
        actions: ['view_services', 'faq']
      },
      decline_offer: {
        text: '好的。你也可以继续问我“哪里还有车位”“为什么推荐这个”“数据来源是什么”“能不能导航”。',
        actions: ['ask_different_question', 'view_services']
      },
      gratitude: {
        text: '不客气。我会继续按演示边界解释停车服务和治理分析能力。',
        actions: []
      }
    };

    return responses[intent.name] || responses.general;
  }

  // Get suggestions for specific intent
  static getIntentSuggestions(intent) {
    const suggestionMap = {
      find_parking: [
        '哪里还有车位？',
        '推荐哪个停车场？',
        '查看当前余位'
      ],
      arrival_assurance: [
        '现在过去稳不稳？',
        '有没有 Plan B？',
        '为什么建议换备选？',
        '到场码有什么用？'
      ],
      recommendation_logic: [
        '为什么推荐这里？',
        '为什么不是最近的？',
        '有没有更稳的备选？'
      ],
      gaode_difference: [
        '和高德停车有什么不同？',
        '我们是不是另一个导航入口？',
        '治理价值在哪里？'
      ],
      check_pricing: [
        '收费规则是什么？',
        '有没有更便宜的？',
        '为什么没有收费标准？',
        '后续怎么接入收费数据？'
      ],
      check_occupancy: [
        '现在拥挤吗？',
        '哪个停车场更宽松？',
        '高占用怎么预警？'
      ],
      get_directions: [
        '怎么导航过去？',
        '坐标从哪里来？',
        '地图点位可信吗？'
      ],
      booking_help: [
        '现在能预约吗？',
        '后续怎么做预约？',
        '需要哪些权限？'
      ],
      release_slot: [
        '车位状态如何更新？',
        'AI 识别如何写回？',
        '能手动释放车位吗？'
      ],
      hours_of_operation: [
        '开放时间从哪里来？',
        '高峰时段怎么判断？',
        '校园规则怎么接入？'
      ],
      payment_methods: [
        '现在支持支付吗？',
        '为什么不接支付？',
        '收费数据如何展示？'
      ],
      data_source: [
        '这些数据真实吗？',
        'OSM 候选是什么意思？',
        'AI 数据集验证是什么？'
      ],
      support: [
        '页面打不开怎么办？',
        '地图不显示怎么办？',
        'API 怎么检查？'
      ],
      general: [
        '我现在过去还有位吗？',
        '有没有备选车场？',
        '怎么导航过去？',
        '数据来源是什么？'
      ],
      show_availability: [
        '查看推荐理由',
        '说明拥挤程度',
        '查看地图点位'
      ],
      pricing_details: [
        '收费待补充怎么办？',
        '北京开放数据能接入吗？',
        '校园收费规则怎么录入？'
      ],
      decline_offer: [
        '换一个问题',
        '你能做什么？',
        '回到停车推荐'
      ]
    };

    return suggestionMap[intent] || suggestionMap.general;
  }

  // Save conversation to database
  static async saveConversation(req, userMessage, botResponse, intent) {
    const sessionId = req.headers['x-session-id'] || 'default-session';
    const userId = req.user?.userId || null;

    const query = `
      INSERT INTO chatbot_conversations (
        session_id,
        user_id,
        user_message,
        bot_response,
        intent,
        confidence,
        entities,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
    `;

    const values = [
      sessionId,
      userId,
      userMessage,
      botResponse.text,
      intent.name,
      intent.confidence,
      JSON.stringify(intent.entities)
    ];

    await db.query(query, values);
  }
}

module.exports = ChatbotController;
