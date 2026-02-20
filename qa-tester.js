const express = require('express');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = 3457;
const API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCuctHpSGjKUba5-YlwF1li8N3I712dd_A';
const GEN_MODEL = 'gemini-3-pro-image-preview';
const QA_MODEL = 'gemini-3-pro-preview';
const ai = new GoogleGenAI({ apiKey: API_KEY, apiVersion: 'v1alpha' });

app.use(express.json({ limit: '50mb' }));

// ── QA endpoint ─────────────────────────────────────────────────────
app.post('/api/qa', async (req, res) => {
  try {
    const { sketchBase64, sketchMimeType, renderBase64, renderMimeType, qaPrompt } = req.body;
    if (!sketchBase64 || !renderBase64 || !qaPrompt) return res.status(400).json({ error: 'Missing images or prompt' });

    const contents = [
      { role: 'user', parts: [
        { text: qaPrompt },
        { inlineData: { mimeType: sketchMimeType || 'image/jpeg', data: sketchBase64 } },
        { inlineData: { mimeType: renderMimeType || 'image/jpeg', data: renderBase64 } }
      ]}
    ];

    const config = {
      responseModalities: ['TEXT'],
      temperature: 1.0, topP: 0.95, topK: 64,
      maxOutputTokens: 4096,
      mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      thinkingConfig: { thinkingLevel: 'high' },
    };

    console.log(`[QA] Running audit via ${QA_MODEL}...`);
    const response = await ai.models.generateContent({ model: QA_MODEL, contents, config });
    const parts = response.candidates?.[0]?.content?.parts || [];
    let text = '';
    for (const p of parts) { if (p.text !== undefined) text += p.text; }
    res.json({ text, usage: response.usageMetadata || {} });
  } catch (e) {
    console.error('[QA Error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Stateful refinement endpoint (conversation continuation) ────────
app.post('/api/refine', async (req, res) => {
  try {
    const { contents } = req.body;
    if (!contents || !contents.length) {
      return res.status(400).json({ error: 'Missing conversation contents' });
    }

    const config = {
      responseModalities: ['IMAGE', 'TEXT'],
      temperature: 1.0, topP: 0.95, topK: 64,
      thinkingConfig: { thinkingBudget: 65535 },
      imageConfig: { aspectRatio: '1:1' },
    };

    console.log(`[Refine] turns=${contents.length} via ${GEN_MODEL}...`);
    const response = await ai.models.generateContent({ model: GEN_MODEL, contents, config });
    const parts = response.candidates?.[0]?.content?.parts || [];

    const result = { images: [], text: '', modelParts: parts, usage: response.usageMetadata || {} };
    for (const p of parts) {
      if (p.inlineData) result.images.push({ mimeType: p.inlineData.mimeType, data: p.inlineData.data });
      if (p.text !== undefined) result.text += p.text;
    }

    if (!result.images.length) return res.status(500).json({ error: result.text || 'No image generated' });
    res.json(result);
  } catch (e) {
    console.error('[Refine Error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Serve HTML ──────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'qa-tester.html')));

app.listen(PORT, () => {
  console.log(`\n🔍 QA Tester running at http://localhost:${PORT}\n`);
});
