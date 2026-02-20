#!/usr/bin/env node
// Manual QA test — pass two image paths as arguments
// Usage: node qa-test.js <sketch.jpg> <render.jpg>

const fs = require('fs');
const path = require('path');

const [sketchPath, renderPath] = process.argv.slice(2);
if (!sketchPath || !renderPath) {
  console.error('Usage: node qa-test.js <sketch-image> <render-image>');
  process.exit(1);
}

const sketchBuf = fs.readFileSync(sketchPath);
const renderBuf = fs.readFileSync(renderPath);
const sketchB64 = sketchBuf.toString('base64');
const renderB64 = renderBuf.toString('base64');
const sketchMime = sketchPath.match(/\.png$/i) ? 'image/png' : 'image/jpeg';
const renderMime = renderPath.match(/\.png$/i) ? 'image/png' : 'image/jpeg';

const qaPrompt = `You are a Senior Jewelry CAD Auditor. Your goal is to identify "Geometric Deviations" between a 2D technical sketch (Image 1) and a 3D render (Image 2). You are not a creative critic; you are a geometric validator.

Compare Image 1 (Sketch) and Image 2 (Render) using this 3-step mandatory process:

STEP 1: SKETCH INVENTORY (Deconstruction)
Analyze Image 1. List every single line, curve, and geometric primitive drawn.

STEP 2: RENDER SUBTRACTION (The Delta)
Look at Image 2. Identify every element that was NOT present in Step 1.
- Flag any added curls, swirls, or flourishes.
- Flag any changes in line 'sharpness' (e.g., if a sharp point became a rounded blob).
- Flag any deviations in band thickness relative to the pencil gauge.

STEP 3: THE VERDICT
- PASS: If the 3D render is a literal 1:1 translation of the sketch lines.
- FAIL: If the AI added ANY "artistic flair" or decorative elements not explicitly drawn in the sketch.

Respond in strict JSON only — no other text:
{
  "audit_steps": {
    "sketch_primitives": ["list", "of", "elements"],
    "hallucinations_detected": ["list", "of", "unauthorized", "additions"],
    "geometric_drift_score": "0-100 (where 0 is a perfect match)"
  },
  "result": "PASS" or "FAIL",
  "pass": true or false,
  "checks": [
    {"name": "geometric_fidelity", "pass": true/false, "detail": "...", "fix": "..."},
    {"name": "hallucinated_elements", "pass": true/false, "detail": "...", "fix": "..."},
    {"name": "line_sharpness", "pass": true/false, "detail": "...", "fix": "..."},
    {"name": "band_thickness", "pass": true/false, "detail": "...", "fix": "..."},
    {"name": "missing_elements", "pass": true/false, "detail": "...", "fix": "..."}
  ],
  "reasoning": "A blunt explanation of why it failed",
  "refinement_instruction": "STRICT OVERRIDE: specific correction instructions"
}`;

async function run() {
  console.log(`Sketch: ${sketchPath} (${(sketchBuf.length/1024).toFixed(1)}KB)`);
  console.log(`Render: ${renderPath} (${(renderBuf.length/1024).toFixed(1)}KB)`);
  console.log('Sending to QA endpoint...\n');

  const res = await fetch('http://localhost:3456/api/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sketchBase64: sketchB64,
      sketchMimeType: sketchMime,
      resultBase64: renderB64,
      resultMimeType: renderMime,
      qaPrompt
    })
  });

  const data = await res.json();
  if (!res.ok) { console.error('ERROR:', data); process.exit(1); }

  console.log('=== RAW RESPONSE ===');
  console.log(data.text);
  console.log('\n=== PARSED ===');
  try {
    const cleaned = data.text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    console.log(JSON.stringify(parsed, null, 2));
  } catch(e) {
    console.log('(Could not parse JSON)', e.message);
  }
  if (data.usage) console.log('\n=== USAGE ===', JSON.stringify(data.usage));
}

run().catch(e => { console.error(e); process.exit(1); });
