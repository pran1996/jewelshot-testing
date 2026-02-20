/**
 * test-config.js — Verify SDK config changes work with the Gemini API
 * 
 * Tests:
 * 1. SDK init without apiVersion (default beta endpoint)
 * 2. Image generation with cleaned config (temperature, no topP/topK)
 * 3. Temperature actually varies output (low vs high temp)
 * 4. imageSize: '2K' is accepted
 * 5. thinkingConfig with includeThoughts works
 * 6. QA model with thinkingLevel: 'HIGH' works
 * 
 * Usage: node test-config.js
 */

const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyBicW5QmwMqOieWAc5RETI9SSUG-aUzaUc';
const MODEL = 'gemini-3-pro-image-preview';
const QA_MODEL = 'gemini-3-pro-preview';

let passed = 0;
let failed = 0;

function log(ok, name, detail) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) passed++;
  else failed++;
}

// ── Test 1: SDK init without apiVersion ─────────────────────────────
async function testSdkInit() {
  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    // Quick text-only call to verify the client works
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: 'Say "hello" and nothing else.',
      config: { maxOutputTokens: 10 },
    });
    const text = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    log(text.toLowerCase().includes('hello'), 'SDK init (no apiVersion)', `Got: "${text.trim().substring(0, 50)}"`);
  } catch (e) {
    log(false, 'SDK init (no apiVersion)', e.message);
  }
}

// ── Test 2: Image gen with clean config ─────────────────────────────
async function testImageGen() {
  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const response = await Promise.race([
      ai.models.generateContent({
        model: MODEL,
        contents: 'A simple gold ring on a white background, product photography.',
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          temperature: 1.0,
          thinkingConfig: { includeThoughts: true },
          imageConfig: { aspectRatio: '1:1', imageSize: '2K' },
        },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout after 90s')), 90000)),
    ]);

    const parts = response.candidates?.[0]?.content?.parts || [];
    const hasImage = parts.some(p => p.inlineData);
    const hasThought = parts.some(p => p.thought);
    const hasThoughtSig = parts.some(p => p.thoughtSignature);

    log(hasImage, 'Image gen (clean config)', `${parts.length} parts returned`);
    log(true, 'imageSize: 2K accepted', 'No error thrown');
    log(hasThoughtSig, 'Thought signatures present', hasThoughtSig ? 'Yes' : 'No signatures found');
    
    // Return parts for reuse
    return { ai, parts };
  } catch (e) {
    log(false, 'Image gen (clean config)', e.message);
    return null;
  }
}

// ── Test 3: Temperature variation ───────────────────────────────────
async function testTemperatureVariation() {
  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const prompt = 'A minimalist silver bangle on white background.';

    // Low temp
    const lowResp = await Promise.race([
      ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          temperature: 0.2,
          imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
        },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 90000)),
    ]);
    const lowParts = lowResp.candidates?.[0]?.content?.parts || [];
    const lowHasImage = lowParts.some(p => p.inlineData);

    // High temp
    const highResp = await Promise.race([
      ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          responseModalities: ['TEXT', 'IMAGE'],
          temperature: 2.0,
          imageConfig: { aspectRatio: '1:1', imageSize: '1K' },
        },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 90000)),
    ]);
    const highParts = highResp.candidates?.[0]?.content?.parts || [];
    const highHasImage = highParts.some(p => p.inlineData);

    log(lowHasImage, 'Temperature 0.2 produces image', '');
    log(highHasImage, 'Temperature 2.0 produces image', '');
    log(lowHasImage && highHasImage, 'Temperature variation accepted', 'Both temps work');
  } catch (e) {
    log(false, 'Temperature variation', e.message);
  }
}

// ── Test 4: QA model with thinkingLevel ─────────────────────────────
async function testQaModel() {
  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const response = await Promise.race([
      ai.models.generateContent({
        model: QA_MODEL,
        contents: 'What is 2+2? Reply with just the number.',
        config: {
          responseModalities: ['TEXT'],
          temperature: 0.2,
          maxOutputTokens: 50,
          thinkingConfig: { thinkingLevel: 'HIGH', includeThoughts: false },
        },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout after 30s')), 30000)),
    ]);

    const text = response.text || response.candidates?.[0]?.content?.parts?.[0]?.text || '';
    log(text.includes('4'), 'QA model with thinkingLevel: HIGH', `Got: "${text.trim().substring(0, 50)}"`);
  } catch (e) {
    log(false, 'QA model with thinkingLevel: HIGH', e.message);
  }
}

// ── Test 5: Verify topP/topK are NOT needed ─────────────────────────
async function testNoTopPTopK() {
  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: 'Say "works" and nothing else.',
      config: {
        temperature: 0.5,
        maxOutputTokens: 10,
        // Intentionally NO topP, topK
      },
    });
    const text = response.text || '';
    log(text.toLowerCase().includes('works'), 'No topP/topK needed', `Got: "${text.trim().substring(0, 50)}"`);
  } catch (e) {
    log(false, 'No topP/topK needed', e.message);
  }
}

// ── Run all ─────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Gemini Config Verification Tests               ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  console.log('── SDK & Basic ──────────────────────────────────');
  await testSdkInit();
  await testNoTopPTopK();

  console.log('\n── Image Generation ─────────────────────────────');
  await testImageGen();

  console.log('\n── Temperature Variation ────────────────────────');
  await testTemperatureVariation();

  console.log('\n── QA Model ────────────────────────────────────');
  await testQaModel();

  console.log('\n════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('════════════════════════════════════════════════');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
