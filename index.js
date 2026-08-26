const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// GLOBAL STATE & SYSTEM PERSONA
// ==========================================
let isAutoReplyActive = true;

let systemPersona = `You are a polite, professional, and persuasive Web Design & Development Sales Assistant.
Your goal is to consult potential clients, understand their website requirements, and pitch appropriate web development services.

Services & Pricing Reference:
1. Landing Page / Single-Page Website: ₹4,999 - ₹8,999 (Delivery in 2-3 days) - Best for ads, products, portfolio.
2. Business Website (4-6 Pages): ₹12,999 - ₹18,999 (Delivery in 5-7 days) - Includes contact forms, SEO basics, mobile-friendly design.
3. E-commerce / Custom Web App: ₹24,999+ (Delivery in 10-15 days) - Includes payment gateway, admin panel, inventory management.

Guidelines:
- Language & Tone: Polite, warm, fluent in English and natural conversational Hinglish.
- Keep responses concise and engaging for WhatsApp (max 3-4 sentences).
- If the client shows strong intent to buy, specifies budget/requirement, agrees to start, or asks for a callback, APPEND THIS SPECIAL TAG AT THE VERY END OF YOUR RESPONSE:
[LEAD_CONFIRMED: <1-sentence summary of requirement, package, and budget>]`;

// In-memory conversation history store
const conversationHistory = new Map();

// ==========================================
// ENVIRONMENT VARIABLES (Render / Local)
// ==========================================
const PORT = process.env.PORT || 3000;
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'https://evolution-api-58gp.onrender.com';
const API_KEY = process.env.EVOLUTION_API_KEY || 'vikash_9919154625';
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'botbiz';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID;

// ==========================================
// TELEGRAM LEAD ALERT SENDER
// ==========================================
async function sendTelegramLeadAlert(clientNumber, leadSummary) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[Telegram Alert Skipped] Missing Bot Token or Chat ID');
    return;
  }

  const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const messageText = `🔥 *NEW CLIENT LEAD DETECTED* 🔥\n\n` +
                      `📱 *Client WhatsApp:* \`+${clientNumber}\`\n` +
                      `📝 *Lead Details:* ${leadSummary}\n` +
                      `⏱ *Time:* ${timestamp}\n\n` +
                      `⚡ [Open WhatsApp Chat](https://wa.me/${clientNumber})`;

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: messageText,
      parse_mode: 'Markdown'
    });
    console.log(`[Telegram] Alert sent successfully for +${clientNumber}`);
  } catch (err) {
    console.error('[Telegram Alert Error]', err.response?.data || err.message);
  }
}

// ==========================================
// OPENROUTER FALLBACK ENGINE
// ==========================================
async function callOpenRouterFallback(userMessage, contextText) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const messages = [{ role: 'system', content: systemPersona }];
  if (contextText) {
    messages.push({ role: 'user', content: `Previous context:\n${contextText}` });
  }
  messages.push({ role: 'user', content: userMessage });

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: OPENROUTER_MODEL,
      messages: messages,
      temperature: 0.75,
      max_tokens: 250
    },
    {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://render.com',
        'X-Title': 'WhatsApp Sales Assistant'
      },
      timeout: 12000
    }
  );

  return response.data?.choices?.[0]?.message?.content?.trim();
}

// ==========================================
// CORE AI ENGINE (Gemini 3.5 Flash-Lite -> OpenRouter)
// ==========================================
async function generateAIReply(userNumber, userMessage) {
  if (!conversationHistory.has(userNumber)) {
    conversationHistory.set(userNumber, []);
  }
  const history = conversationHistory.get(userNumber);

  // Keep last 6 messages
  if (history.length > 6) {
    history.splice(0, history.length - 6);
  }

  const contextText = history
    .map(entry => `${entry.role === 'user' ? 'Client' : 'Assistant'}: ${entry.text}`)
    .join('\n');

  let aiRawText = '';

  // 1. Primary Engine: Gemini 3.5 Flash-Lite
  if (GEMINI_API_KEY) {
    try {
      const fullPrompt = `${systemPersona}\n\nRecent Conversation:\n${contextText}\nClient: ${userMessage}\nAssistant:`;
      const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`;

      const response = await axios.post(
        geminiEndpoint,
        {
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            temperature: 0.75,
            maxOutputTokens: 250
          }
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 10000
        }
      );

      aiRawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (aiRawText) console.log('[AI Provider] Response via Gemini 3.5 Flash-Lite');
    } catch (geminiErr) {
      console.error('[Gemini Failed -> Switching to OpenRouter]:', geminiErr.response?.data || geminiErr.message);
    }
  }

  // 2. Secondary Fallback: OpenRouter
  if (!aiRawText && OPENROUTER_API_KEY) {
    try {
      aiRawText = await callOpenRouterFallback(userMessage, contextText);
      if (aiRawText) console.log(`[AI Provider] Response via OpenRouter (${OPENROUTER_MODEL})`);
    } catch (openRouterErr) {
      console.error('[OpenRouter Fallback Failed]:', openRouterErr.response?.data || openRouterErr.message);
    }
  }

  // 3. Static Hinglish Default
  const finalReply = aiRawText || "Hi! Thanks for reaching out. Please let me know what kind of website you need and I will assist you right away.";

  // Save turn in memory
  history.push({ role: 'user', text: userMessage });
  history.push({ role: 'assistant', text: finalReply });

  return finalReply;
}

// ==========================================
// DASHBOARD REST APIS
// ==========================================
app.get('/api/status', (req, res) => {
  res.json({
    active: isAutoReplyActive,
    persona: systemPersona,
    instance: INSTANCE_NAME,
    activeChats: conversationHistory.size,
    telegramConfigured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
  });
});

app.post('/api/settings', (req, res) => {
  if (typeof req.body.active === 'boolean') {
    isAutoReplyActive = req.body.active;
  }
  if (req.body.persona) {
    systemPersona = req.body.persona;
  }
  res.json({ success: true, active: isAutoReplyActive, persona: systemPersona });
});

app.post('/api/clear-history', (req, res) => {
  conversationHistory.clear();
  res.json({ success: true, message: 'Conversation memory cleared.' });
});

// Root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// EVOLUTION API WEBHOOK LISTENER
// ==========================================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  if (!isAutoReplyActive) {
    console.log('[Bot Paused] Incoming message ignored.');
    return;
  }

  const payload = req.body;

  if (payload.event === 'messages.upsert') {
    const data = payload.data;
    if (data?.key?.fromMe) return;

    const remoteJid = data?.key?.remoteJid || '';
    if (remoteJid.includes('@g.us') || remoteJid.includes('@newsletter') || remoteJid.includes('status@broadcast')) {
      return;
    }

    const incomingText = data?.message?.conversation || data?.message?.extendedTextMessage?.text;

    if (incomingText) {
      const recipientNumber = remoteJid.replace('@s.whatsapp.net', '');
      console.log(`\n[📩 Incoming WhatsApp] +${recipientNumber}: "${incomingText}"`);

      try {
        let aiResponseText = await generateAIReply(recipientNumber, incomingText);

        // Check if lead detection triggered
        if (aiResponseText.includes('[LEAD_CONFIRMED:')) {
          const match = aiResponseText.match(/\[LEAD_CONFIRMED:\s*(.*?)\]/);
          const leadDetails = match ? match[1] : incomingText;

          // Send Telegram alert
          await sendTelegramLeadAlert(recipientNumber, leadDetails);

          // Clean tag before sending to client
          aiResponseText = aiResponseText.replace(/\[LEAD_CONFIRMED:.*?\]/, '').trim();
        }

        // Send reply via Evolution API with typing simulation
        await axios.post(
          `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_NAME}`,
          {
            number: recipientNumber,
            text: aiResponseText,
            options: {
              delay: 1500,
              presence: "composing"
            }
          },
          {
            headers: {
              'apikey': API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`[🚀 Sent WhatsApp] Replied to +${recipientNumber}: "${aiResponseText}"`);
      } catch (err) {
        console.error('[Send Error]', err.response?.data || err.message);
      }
    }
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ WhatsApp Sales Assistant Server active on port ${PORT}`);
  console.log(`🔗 Instance: ${INSTANCE_NAME} | Evolution URL: ${EVOLUTION_API_URL}\n`);
});
    
