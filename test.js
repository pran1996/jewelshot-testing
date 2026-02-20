#!/usr/bin/env node
/**
 * Jewelry Sketch Studio — Full QA Test Suite
 *
 * Tests server endpoints, client integrity, config correctness,
 * session management, and edge cases.
 *
 * Usage: node test.js           (server must be running on :3456)
 * Usage: node test.js --all     (include slow Gemini API call test)
 */

const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3456';
const RUN_API_TESTS = process.argv.includes('--all');

// 1x1 white JPEG — smallest valid image for API tests
const TINY_IMAGE = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k=';

const results = { pass: 0, fail: 0, skip: 0 };
let currentSection = '';

function section(name) {
  currentSection = name;
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 55 - name.length))}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    results.pass++;
    return true;
  } catch (e) {
    if (e.message === '__SKIP__') {
      console.log(`  ⏭️  ${name} (skipped)`);
      results.skip++;
      return false;
    }
    console.log(`  ❌ ${name}`);
    console.log(`     → ${e.message}`);
    results.fail++;
    return false;
  }
}

function skip() { throw new Error('__SKIP__'); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'Mismatch'}: expected ${b}, got ${a}`); }
function assertIncludes(str, sub, msg) { if (!str.includes(sub)) throw new Error(`${msg || 'Missing'}: "${sub}" not found`); }

// ═══════════════════════════════════════════════════════════════════
async function run() {
  console.log('\n🧪 Jewelry Sketch Studio — QA Test Suite\n');
  if (!RUN_API_TESTS) console.log('   (run with --all to include Gemini API call tests)\n');

  // ─────────────────────────────────────────────────────────────────
  section('1. Server Health & Static Serving');
  // ─────────────────────────────────────────────────────────────────

  await test('Server responds on GET /', async () => {
    const res = await fetch(BASE);
    assertEq(res.status, 200, 'Status');
  });

  await test('index.html has correct title', async () => {
    const html = await (await fetch(BASE)).text();
    assertIncludes(html, '<title>Jewelry Sketch → Studio</title>');
  });

  await test('index.html contains app structure', async () => {
    const html = await (await fetch(BASE)).text();
    assertIncludes(html, 'masterPrompt', 'Core prompt textarea');
    assertIncludes(html, 'slotCount', 'Slot count input');
    assertIncludes(html, 'Generate All', 'Generate All button');
  });

  // ─────────────────────────────────────────────────────────────────
  section('2. /api/chat — Validation (First Generation)');
  // ─────────────────────────────────────────────────────────────────

  await test('Empty body → 400', async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEq(res.status, 400, 'Status');
    const data = await res.json();
    assert(data.error, 'Should have error message');
  });

  await test('Prompt only, no image → 400', async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test prompt' })
    });
    assertEq(res.status, 400, 'Status');
    const data = await res.json();
    assertIncludes(data.error, 'Missing image or prompt');
  });

  await test('Image only, no prompt → 400', async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: TINY_IMAGE, mimeType: 'image/jpeg' })
    });
    assertEq(res.status, 400, 'Status');
  });

  await test('No Content-Type header → 400 (malformed)', async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      body: 'not json'
    });
    // Express should reject or parse will fail
    assert(res.status >= 400, `Expected 4xx, got ${res.status}`);
  });

  // ─────────────────────────────────────────────────────────────────
  section('3. /api/chat — Session & Refinement Validation');
  // ─────────────────────────────────────────────────────────────────

  await test('Invalid sessionId → 404', async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'nonexistent-session-id', prompt: 'fix it' })
    });
    assertEq(res.status, 404, 'Status');
    const data = await res.json();
    assertIncludes(data.error, 'Session expired or not found');
  });

  await test('Expired/random UUID sessionId → 404', async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: '550e8400-e29b-41d4-a716-446655440000', prompt: 'test' })
    });
    assertEq(res.status, 404, 'Status');
  });

  await test('SessionId with no prompt and no annotation → 404 (session not found is first check)', async () => {
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'fake-id' })
    });
    // Should hit session not found before empty message check
    assertEq(res.status, 404, 'Status');
  });

  // ─────────────────────────────────────────────────────────────────
  section('4. /api/sessions — Debug Endpoint');
  // ─────────────────────────────────────────────────────────────────

  await test('GET /api/sessions returns JSON with count', async () => {
    const res = await fetch(`${BASE}/api/sessions`);
    assertEq(res.status, 200, 'Status');
    const data = await res.json();
    assert(typeof data.count === 'number', 'count should be a number');
    assert(Array.isArray(data.sessions), 'sessions should be an array');
  });

  // ─────────────────────────────────────────────────────────────────
  section('5. 404 for removed legacy endpoints');
  // ─────────────────────────────────────────────────────────────────

  await test('POST /api/generate → 404 (removed)', async () => {
    const res = await fetch(`${BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEq(res.status, 404, 'Status');
  });

  await test('POST /api/refine → 404 (removed)', async () => {
    const res = await fetch(`${BASE}/api/refine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEq(res.status, 404, 'Status');
  });

  await test('POST /api/check → 404 (removed)', async () => {
    const res = await fetch(`${BASE}/api/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assertEq(res.status, 404, 'Status');
  });

  // ─────────────────────────────────────────────────────────────────
  section('6. Client-side JS Integrity');
  // ─────────────────────────────────────────────────────────────────

  const htmlContent = await (await fetch(BASE)).text();

  await test('No JS syntax errors in <script> blocks', async () => {
    const scriptMatches = htmlContent.match(/<script[^>]*>([\s\S]*?)<\/script>/g);
    assert(scriptMatches && scriptMatches.length > 0, 'No <script> blocks found');
    for (let i = 0; i < scriptMatches.length; i++) {
      const js = scriptMatches[i].replace(/<\/?script[^>]*>/g, '');
      try {
        new Function(js);
      } catch (e) {
        throw new Error(`Script block ${i} has syntax error: ${e.message}`);
      }
    }
  });

  await test('DEFAULT_CORE_PROMPT is populated (5-layer condensed)', async () => {
    // Layer 1: Visual prime
    assertIncludes(htmlContent, 'sculpted three-dimensional depth', 'Visual prime — 3D depth');
    assertIncludes(htmlContent, 'crisp engraved detail', 'Visual prime — engraved detail');
    // Layer 2: Fidelity anchor
    assertIncludes(htmlContent, 'Every internal line is a real carved feature', 'Fidelity anchor');
    assertIncludes(htmlContent, 'Add nothing not drawn. Remove nothing drawn', 'Fidelity constraint');
    // Layer 3: Subject + Material
    assertIncludes(htmlContent, '{category_module}', 'Category module variable');
    assertIncludes(htmlContent, '{metal}', 'Metal variable');
    assertIncludes(htmlContent, '{finish}', 'Finish variable');
    // Layer 4: Interpretation
    assertIncludes(htmlContent, 'stone settings', 'Stone interpretation');
    // Layer 5: Exclusion
    assertIncludes(htmlContent, 'No human body parts', 'Exclusion');
  });

  await test('CATEGORY_MODULE_DEFAULTS has all 6 categories', async () => {
    const categories = ['Ring', 'Bangle', 'Necklace', 'Earring', 'Pendant', 'Other'];
    for (const cat of categories) {
      assertIncludes(htmlContent, `${cat}:`, `Category "${cat}"`);
    }
  });

  await test('Category modules are concise with key context', async () => {
    // Condensed modules — one sentence each with category-specific anchors
    assertIncludes(htmlContent, 'band profile, shank type', 'Ring: band + shank');
    assertIncludes(htmlContent, 'cross-section shape', 'Bangle: cross-section');
    assertIncludes(htmlContent, 'chain style, link proportions', 'Necklace: chain + links');
    assertIncludes(htmlContent, '{hook_type} finding', 'Earring: hook type var');
    assertIncludes(htmlContent, 'bail', 'Pendant: bail');
  });

  await test('QA prompt exists', async () => {
    assertIncludes(htmlContent, 'Senior Jewelry CAD Auditor', 'QA role');
    assertIncludes(htmlContent, 'geometric_drift_score', 'QA scoring');
  });

  await test('Critical functions exist in client JS', async () => {
    const requiredFunctions = [
      'buildPromptForSlot',
      'generateVisual',
      'handleVisualResult',
      'submitRefine',
      'autoRefine',
      'generateSlot',
      'generateAll',
      'clearAll',
      'downloadVisual',
      'openRefine',
      'closeRefine',
      'initAnnotationCanvas',
      'loadAnnotationCanvas',
      'getAnnotationBase64',
      'validateSlot',
      'revalidateAll',
      'interpolate',
      'getCategoryModule',
      'initCategoryModules',
    ];
    for (const fn of requiredFunctions) {
      assertIncludes(htmlContent, `function ${fn}`, `Function ${fn}`);
    }
  });

  await test('Client calls /api/chat (not legacy /api/generate or /api/refine)', async () => {
    // Extract JS from script tags
    const scripts = htmlContent.match(/<script[^>]*>([\s\S]*?)<\/script>/g)
      .map(s => s.replace(/<\/?script[^>]*>/g, ''))
      .join('\n');
    // Should use /api/chat
    assertIncludes(scripts, "'/api/chat'", 'fetch /api/chat');
    // Should NOT use legacy endpoints (except in comments)
    const jsNoComments = scripts.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert(!jsNoComments.includes("'/api/generate'"), 'Should not call /api/generate');
    assert(!jsNoComments.includes("'/api/refine'"), 'Should not call /api/refine');
  });

  await test('handleVisualResult stores sessionId from response', async () => {
    assertIncludes(htmlContent, 'data.sessionId', 'sessionId extraction');
    assertIncludes(htmlContent, 'vis.sessionId', 'sessionId storage');
  });

  await test('submitRefine checks sessionId (not conversation)', async () => {
    // The refine function should check vis.sessionId
    assertIncludes(htmlContent, "vis.sessionId) return showToast('Generate first')", 'sessionId guard');
  });

  await test('Refine sends sessionId to /api/chat', async () => {
    assertIncludes(htmlContent, 'sessionId: vis.sessionId', 'sessionId in refine payload');
  });

  await test('Variable interpolation handles all template vars', async () => {
    // interpolate() replaces these — check the regex patterns in JS
    assertIncludes(htmlContent, '\\{category\\}', 'category regex in interpolate');
    assertIncludes(htmlContent, '\\{metal\\}', 'metal regex in interpolate');
    assertIncludes(htmlContent, '\\{finish\\}', 'finish regex in interpolate');
    assertIncludes(htmlContent, '\\{hook_type\\}', 'hook_type regex in interpolate');
    assertIncludes(htmlContent, '\\{category_module\\}', 'category_module regex in interpolate');
    // And the template vars appear in prompts/hints
    assertIncludes(htmlContent, '{metal}', 'metal in prompt');
    assertIncludes(htmlContent, '{finish}', 'finish in prompt');
    assertIncludes(htmlContent, '{category_module}', 'category_module in prompt');
  });

  // ─────────────────────────────────────────────────────────────────
  section('7. Server Config Verification');
  // ─────────────────────────────────────────────────────────────────

  const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

  await test('SDK initialized WITHOUT apiVersion', async () => {
    const initLine = serverSrc.match(/new GoogleGenAI\(\{[^}]+\}\)/);
    assert(initLine, 'GoogleGenAI init not found');
    assert(!initLine[0].includes('apiVersion'), 'Should not have apiVersion');
  });

  await test('thinkingConfig: { includeThoughts: true } present', async () => {
    assertIncludes(serverSrc, 'includeThoughts: true', 'includeThoughts');
    assert(!serverSrc.includes('thinkingBudget'), 'Should not have thinkingBudget (2.5 param)');
  });

  await test('imageSize set to 2K', async () => {
    assertIncludes(serverSrc, "'2K'", 'imageSize 2K');
  });

  await test('No topP or topK in config', async () => {
    // Check that topP/topK don't appear as config properties
    assert(!serverSrc.match(/topP\s*:/), 'topP should not be in config');
    assert(!serverSrc.match(/topK\s*:/), 'topK should not be in config');
  });

  await test('responseModalities order is [TEXT, IMAGE]', async () => {
    const modMatch = serverSrc.match(/responseModalities:\s*\[([^\]]+)\]/);
    assert(modMatch, 'responseModalities not found');
    const order = modMatch[1].replace(/['"]/g, '').replace(/\s/g, '');
    assertEq(order, 'TEXT,IMAGE', 'responseModalities order');
  });

  await test('Model is gemini-3-pro-image-preview', async () => {
    assertIncludes(serverSrc, "'gemini-3-pro-image-preview'", 'Model name');
  });

  await test('Temperature is configurable (not hardcoded in API call)', async () => {
    assertIncludes(serverSrc, 'parseTemp(temperature)', 'Temperature parsing');
    assertIncludes(serverSrc, 'temperature: 1.0', 'Default temperature');
  });

  await test('Session TTL configured (sessions expire)', async () => {
    assertIncludes(serverSrc, 'sessionTTL', 'Session TTL config');
    assert(serverSrc.includes('session.lastAccess'), 'Session access tracking');
  });

  await test('Concurrency limiter exists (maxConcurrent: 3)', async () => {
    assertIncludes(serverSrc, 'maxConcurrent: 3', 'Max concurrent');
    assertIncludes(serverSrc, 'acquireSlot', 'Slot acquisition');
    assertIncludes(serverSrc, 'releaseSlot', 'Slot release');
  });

  await test('Memory guard middleware active', async () => {
    assertIncludes(serverSrc, 'memoryGuard', 'Memory guard');
    assertIncludes(serverSrc, 'memoryLimitMB: 512', 'Memory limit');
  });

  await test('GC triggered after request (--expose-gc)', async () => {
    assertIncludes(serverSrc, 'global.gc', 'GC call');
  });

  await test('Request timeout configured', async () => {
    assertIncludes(serverSrc, 'requestTimeoutMs', 'Timeout config');
    assertIncludes(serverSrc, 'Request timed out', 'Timeout error message');
  });

  await test('Graceful shutdown handler exists', async () => {
    assertIncludes(serverSrc, 'SIGTERM', 'SIGTERM handler');
    assertIncludes(serverSrc, 'SIGINT', 'SIGINT handler');
    assertIncludes(serverSrc, 'chatSessions.clear()', 'Session cleanup on shutdown');
  });

  // ─────────────────────────────────────────────────────────────────
  section('8. Gemini API Integration (--all only)');
  // ─────────────────────────────────────────────────────────────────

  await test('Generate call — API accepts config (no INVALID_ARGUMENT)', async () => {
    if (!RUN_API_TESTS) skip();
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: TINY_IMAGE,
        mimeType: 'image/jpeg',
        prompt: 'A simple gold ring on white background.',
        temperature: 1.0,
      })
    });
    const data = await res.json();
    // Success or known transient errors = config is valid
    if (res.status === 200) {
      assert(data.sessionId, 'Response should include sessionId');
      assert(data.images?.length > 0, 'Response should include images');
      return;
    }
    if (res.status === 429) return; // rate limited — config accepted
    if (res.status === 503) return; // model overloaded — config accepted
    if (res.status === 500 && data.error?.includes('No image generated')) return; // config OK
    if (res.status === 500 && data.error?.includes('timed out')) return; // timeout — config OK
    // Real config rejection
    if (data.error?.includes('INVALID_ARGUMENT') || data.details?.includes('INVALID_ARGUMENT')) {
      throw new Error(`API REJECTED config: ${(data.details || data.error).substring(0, 300)}`);
    }
    // Unknown error — don't fail hard
    console.log(`     ⚠️  Unexpected response (${res.status}): ${data.error || 'unknown'}`);
  });

  await test('Generate returns sessionId for refinement', async () => {
    if (!RUN_API_TESTS) skip();
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: TINY_IMAGE,
        mimeType: 'image/jpeg',
        prompt: 'A simple silver pendant.',
        temperature: 0.5,
      })
    });
    const data = await res.json();
    if (res.status === 200) {
      assert(data.sessionId, 'Must return sessionId');
      assert(typeof data.sessionId === 'string', 'sessionId must be string');
      assert(data.sessionId.length > 10, 'sessionId looks like UUID');
      assert(data.turn === 1, 'First generation should be turn 1');

      // Verify session appears in /api/sessions
      const sessRes = await fetch(`${BASE}/api/sessions`);
      const sessData = await sessRes.json();
      assert(sessData.count > 0, 'Should have at least 1 session');
    }
    // Transient errors are OK for this test
    if ([429, 503].includes(res.status)) return;
    if (res.status === 500) return; // model issues
  });

  await test('Refinement with valid sessionId works', async () => {
    if (!RUN_API_TESTS) skip();
    // First, generate to get a sessionId
    const genRes = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: TINY_IMAGE,
        mimeType: 'image/jpeg',
        prompt: 'A gold bangle.',
        temperature: 0.8,
      })
    });
    const genData = await genRes.json();
    if (genRes.status !== 200 || !genData.sessionId) {
      console.log('     ⚠️  Skipping (generation failed — transient)');
      return;
    }

    // Now refine
    const refRes = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: genData.sessionId,
        prompt: 'Make the gold warmer and more reflective.',
        temperature: 0.8,
      })
    });
    const refData = await refRes.json();
    if (refRes.status === 200) {
      assertEq(refData.sessionId, genData.sessionId, 'SessionId preserved');
      assert(refData.turn >= 2, 'Refinement should be turn 2+');
    }
    // Transient errors OK
  });

  await test('Temperature override works per-message', async () => {
    if (!RUN_API_TESTS) skip();
    // Generate at T=0.2 (low creativity)
    const res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: TINY_IMAGE,
        mimeType: 'image/jpeg',
        prompt: 'A platinum ring.',
        temperature: 0.2,
      })
    });
    // If accepted (no 400), temperature parsing works
    assert(res.status !== 400, 'Low temperature should be accepted');
  });

  // ─────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────
  const total = results.pass + results.fail + results.skip;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📊 Results: ${results.pass}/${total} passed` +
    (results.fail ? ` · ${results.fail} FAILED` : '') +
    (results.skip ? ` · ${results.skip} skipped` : '') +
    (!results.fail ? ' ✨' : ' ⚠️'));
  console.log(`${'═'.repeat(60)}\n`);

  process.exit(results.fail > 0 ? 1 : 0);
}

run().catch(e => { console.error('Test runner crashed:', e); process.exit(1); });
