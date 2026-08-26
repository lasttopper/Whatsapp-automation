const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Bot State
let isAutoReplyActive = true;

// Default System Persona for Selling Websites & Personal Consulting
let systemPersona = `You are a polite, professional, and persuasive Web Design & Development Sales Assistant.
Your goal is to consult potential clients, understand their website requirements, and pitch appropriate web development services.

Services & Pricing Reference:
1. Landing Page / Single-Page Website: ₹4,999 - ₹8,999 (Delivery in 2-3 days) - Best for ads, products, portfolio.
2. Business Website (4-6 Pages): ₹12,999 - ₹18,999 (Delivery in 5-7 days) - Includes contact forms, SEO basics, mobile-friendly design.
3. E-commerce / Custom Web App: ₹24,999+ (Delivery in 10-15 days) - Includes payment gateway, admin panel, inventory management.

Guidelines:
- Language & Tone: Professional, warm, fluent in English & natural Hinglish (matching user preference).
- Ask 1-2 clarifying questions: What type of business is it? Do they already have a domain/hosting or design idea?
- Emphasize benefits: Fast loading speed, mobile responsive design, modern UI/UX, and free 1-month support.
- Keep responses concise for WhatsApp (max 3-5 sentences).
- If client asks for direct human contact or a call, ask for their preferred time or state that the lead developer will connect shortly.`;

// In-memory conversation history store (Key: Phone number, Value: Array of messages)
const conversationHistory = new Map();

// Environment Variables
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
const API_KEY = process.env.EVOLUTION_API_KEY || 'global_api_key';
const INSTANCE_NAME = process.env.INSTANCE_NAME || 'my-bot';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Generate AI response using Gemini with memory
async function generateAIReply(userNumber, userMessage) {
  if (!GEMINI_API_KEY) {
    return "Thank you for reaching out! We provide custom web development and digital solutions. Our team will get back to you shortly.";
  }

  // Retrieve or initialize conversation history for this contact
  if (!conversationHistory.has(userNumber)) {
    conversationHistory.set(userNumber, []);
  }
  const history = conversationHistory.get(userNumber);

  // Maintain sliding window (last 6 messages)
  if (history.length > 6) {
    history.splice(0, history.length - 6);
  }

  // Build history context string
  const conversationContext = history
    .map(entry => `${entry.role === 'user' ? 'Client' : 'Assistant'}: ${entry.text}`)
    .join('\n');

  const fullPrompt = `${systemPersona}

Recent Conversation:
${conversationContext}
Client: ${userMessage}
Assistant:`;

  const geminiEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const response = await axios.post(geminiEndpoint, {
      contents: [{
        parts: [{ text: fullPrompt }]
      }]
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    const aiText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    const finalReply = aiText || "Thank you for your message! How can I assist with your website requirement today?";

    // Save to memory
    history.push({ role: 'user', text: userMessage });
    history.push({ role: 'assistant', text: finalReply });

    return finalReply;
  } catch (error) {
    console.error("[Gemini API Error]", error.response?.data || error.message);
    return "Hi! Thanks for getting in touch. I am having a brief network issue, but please let me know what kind of website you need and I will assist you right away.";
  }
}

// REST API for Dashboard
app.get('/api/status', (req, res) => {
  res.json({
    active: isAutoReplyActive,
    persona: systemPersona,
    instance: INSTANCE_NAME,
    activeChats: conversationHistory.size
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
  res.json({ success: true, message: "Chat memory cleared" });
});

// Evolution API Webhook Receiver
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  if (!isAutoReplyActive) return;

  const payload = req.body;

  if (payload.event === 'messages.upsert') {
    const data = payload.data;
    if (data?.key?.fromMe) return;

    const remoteJid = data?.key?.remoteJid || '';
    if (remoteJid.includes('@g.us') || remoteJid.includes('@newsletter')) return;

    const incomingText = data?.message?.conversation || 
                         data?.message?.extendedTextMessage?.text;

    if (incomingText) {
      const recipientNumber = remoteJid.replace('@s.whatsapp.net', '');
      console.log(`[Incoming] ${recipientNumber}: "${incomingText}"`);

      try {
        const aiResponseText = await generateAIReply(recipientNumber, incomingText);

        await axios.post(
          `${EVOLUTION_API_URL}/message/sendText/${INSTANCE_NAME}`,
          {
            number: recipientNumber,
            text: aiResponseText
          },
          {
            headers: {
              'apikey': API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`[Sent] Reply to ${recipientNumber}`);
      } catch (err) {
        console.error('[Send Error]', err.response?.data || err.message);
      }
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Web Assistant Server running on port ${PORT}`);
});
