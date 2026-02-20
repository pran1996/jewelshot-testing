#!/usr/bin/env python3
"""
Jewelry Sketch Preprocessing Pipeline Demo
Standalone server on port 3457 — upload a sketch, see all 6 pipeline steps.
"""

import cv2
import numpy as np
import base64
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse
import io

PORT = 3457

def img_to_base64(img, fmt=".jpg"):
    """Convert OpenCV image to base64 data URL."""
    ok, buf = cv2.imencode(fmt, img)
    if not ok:
        return ""
    b64 = base64.b64encode(buf).decode("utf-8")
    mime = "image/jpeg" if fmt == ".jpg" else "image/png"
    return f"data:{mime};base64,{b64}"

def run_pipeline(img_bytes):
    """
    Run the full 6-step preprocessing pipeline.
    Returns list of { name, description, image_b64 } for each step.
    """
    # Decode input
    arr = np.frombuffer(img_bytes, np.uint8)
    original = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if original is None:
        return {"error": "Failed to decode image"}

    h, w = original.shape[:2]
    steps = []

    # Step 0: Original
    steps.append({
        "name": "Original",
        "description": f"Input image as received ({w}×{h})",
        "image": img_to_base64(original)
    })

    # Step 1: Grayscale conversion
    gray = cv2.cvtColor(original, cv2.COLOR_BGR2GRAY)
    steps.append({
        "name": "① Grayscale",
        "description": "Convert to single-channel grayscale. Removes color noise, reduces data for processing.",
        "image": img_to_base64(cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR))
    })

    # Step 2: Bilateral filter (denoise, preserve edges)
    bilateral = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)
    steps.append({
        "name": "② Bilateral Filter",
        "description": "Denoise while preserving edges. d=9, σColor=75, σSpace=75. Smooths paper texture without blurring pencil lines.",
        "image": img_to_base64(cv2.cvtColor(bilateral, cv2.COLOR_GRAY2BGR))
    })

    # Step 3: CLAHE (adaptive contrast enhancement)
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(bilateral)
    steps.append({
        "name": "③ CLAHE",
        "description": "Contrast Limited Adaptive Histogram Equalization. clipLimit=3.0, grid=8×8. Makes faint pencil strokes visible without blowing out highlights.",
        "image": img_to_base64(cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR))
    })

    # Step 4: Adaptive threshold (background → white, lines → black)
    # Gaussian adaptive threshold works better for uneven lighting
    thresh = cv2.adaptiveThreshold(
        enhanced, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=21,  # neighborhood size (must be odd)
        C=10           # constant subtracted from mean
    )
    steps.append({
        "name": "④ Adaptive Threshold",
        "description": "Gaussian adaptive threshold. blockSize=21, C=10. Separates lines from background even with uneven lighting. Paper → white, lines → black.",
        "image": img_to_base64(cv2.cvtColor(thresh, cv2.COLOR_GRAY2BGR))
    })

    # Step 5: Morphological close (fill tiny gaps in lines)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2, 2))
    closed = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=1)
    steps.append({
        "name": "⑤ Morphological Close",
        "description": "Close operation with 2×2 ellipse kernel. Fills tiny gaps in pencil lines without thickening them too much.",
        "image": img_to_base64(cv2.cvtColor(closed, cv2.COLOR_GRAY2BGR))
    })

    # Step 6: Final cleanup — ensure white background, dark lines
    # Invert check: if more than 50% of pixels are dark, it's likely inverted
    white_ratio = np.sum(closed > 127) / closed.size
    if white_ratio < 0.5:
        final = cv2.bitwise_not(closed)
        invert_note = " (inverted — detected dark background)"
    else:
        final = closed
        invert_note = " (no inversion needed)"

    # Optional: slight denoise on the final to remove speckles
    final = cv2.medianBlur(final, 3)

    steps.append({
        "name": "⑥ Final Cleanup",
        "description": f"Median blur (3px) to remove speckles{invert_note}. Clean dark lines on white background, ready for Gemini.",
        "image": img_to_base64(cv2.cvtColor(final, cv2.COLOR_GRAY2BGR))
    })

    # Also generate some alternative approaches for comparison
    # Alt A: Lighter touch — just CLAHE + light threshold
    alt_light = cv2.adaptiveThreshold(
        enhanced, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=31,
        C=6  # lower C = less aggressive
    )
    steps.append({
        "name": "Alt A: Light Touch",
        "description": "Less aggressive threshold (blockSize=31, C=6). Preserves more subtle shading and detail at the cost of some background noise.",
        "image": img_to_base64(cv2.cvtColor(alt_light, cv2.COLOR_GRAY2BGR))
    })

    # Alt B: CLAHE only (no threshold) — keeps full tonal range
    clahe_only = cv2.cvtColor(enhanced, cv2.COLOR_GRAY2BGR)
    # Brighten the background
    clahe_bright = cv2.convertScaleAbs(enhanced, alpha=1.3, beta=40)
    steps.append({
        "name": "Alt B: CLAHE Only (No Threshold)",
        "description": "Just contrast enhancement + brightness boost (α=1.3, β=40). Preserves all tonal information — pencil pressure, shading, soft edges. Least destructive.",
        "image": img_to_base64(cv2.cvtColor(clahe_bright, cv2.COLOR_GRAY2BGR))
    })

    # Alt C: Canny edge detection — extracts just the lines
    edges = cv2.Canny(bilateral, 30, 100)
    edges_inv = cv2.bitwise_not(edges)  # white bg, black lines
    steps.append({
        "name": "Alt C: Canny Edge Detection",
        "description": "Canny edges (low=30, high=100). Extracts clean line art. Very clean but loses all shading and pencil weight information.",
        "image": img_to_base64(cv2.cvtColor(edges_inv, cv2.COLOR_GRAY2BGR))
    })

    return {"steps": steps}


HTML_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sketch Preprocessing Pipeline Demo</title>
<style>
  :root { --bg:#0a0a0a; --surface:#141414; --surface-2:#1e1e1e; --border:#2a2a2a; --text:#e8e8e8; --text-dim:#888; --accent:#c9a55a; --accent-glow:rgba(201,165,90,0.12); }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,system-ui,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; padding:20px; }
  h1 { font-size:20px; margin-bottom:4px; } h1 span { color:var(--accent); }
  .subtitle { color:var(--text-dim); font-size:13px; margin-bottom:20px; }
  .upload-zone { border:2px dashed var(--border); border-radius:12px; padding:40px; text-align:center; cursor:pointer; transition:all 0.2s; margin-bottom:20px; }
  .upload-zone:hover, .upload-zone.dragover { border-color:var(--accent); background:var(--accent-glow); }
  .upload-zone .icon { font-size:40px; } .upload-zone p { color:var(--text-dim); margin-top:8px; font-size:13px; }
  .upload-zone p strong { color:var(--accent); }
  .upload-zone.processing { pointer-events:none; opacity:0.6; }
  .upload-zone.processing .icon::after { content:' Processing...'; font-size:14px; }
  input[type=file] { display:none; }
  .steps { display:grid; grid-template-columns:repeat(auto-fill, minmax(350px,1fr)); gap:16px; }
  .step { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  .step-header { padding:10px 14px; border-bottom:1px solid var(--border); background:var(--surface-2); }
  .step-header h3 { font-size:14px; font-weight:600; color:var(--accent); }
  .step-header p { font-size:11px; color:var(--text-dim); margin-top:3px; line-height:1.4; }
  .step img { width:100%; display:block; }
  .loading { text-align:center; padding:40px; color:var(--text-dim); font-size:14px; }
  .spinner { display:inline-block; width:24px; height:24px; border:3px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:spin 0.8s linear infinite; margin-right:8px; vertical-align:middle; }
  @keyframes spin { to { transform:rotate(360deg); } }
</style>
</head>
<body>
<h1>🔬 Sketch <span>Preprocessing</span> Pipeline</h1>
<p class="subtitle">Upload a jewelry sketch to see all 6 pipeline steps + alternative approaches</p>

<div class="upload-zone" id="zone" onclick="document.getElementById('fileInput').click()">
  <div class="icon">📸</div>
  <p>Drop your sketch here or <strong>click to upload</strong></p>
</div>
<input type="file" id="fileInput" accept="image/*">

<div id="results"></div>

<script>
const zone = document.getElementById('zone');
const fileInput = document.getElementById('fileInput');
const results = document.getElementById('results');

zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); if(e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if(fileInput.files[0]) processFile(fileInput.files[0]); });

async function processFile(file) {
  zone.classList.add('processing');
  results.innerHTML = '<div class="loading"><span class="spinner"></span>Running preprocessing pipeline...</div>';

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    try {
      const res = await fetch('/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 })
      });
      const data = await res.json();
      if (data.error) { results.innerHTML = `<div class="loading">❌ ${data.error}</div>`; return; }
      renderSteps(data.steps);
    } catch (err) {
      results.innerHTML = `<div class="loading">❌ ${err.message}</div>`;
    } finally {
      zone.classList.remove('processing');
    }
  };
  reader.readAsDataURL(file);
}

function renderSteps(steps) {
  results.innerHTML = '<div class="steps">' + steps.map(s => `
    <div class="step">
      <div class="step-header"><h3>${s.name}</h3><p>${s.description}</p></div>
      <img src="${s.image}" alt="${s.name}">
    </div>
  `).join('') + '</div>';
}
</script>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[{self.command}] {args[0] if args else ''}")

    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(HTML_PAGE.encode())

    def do_POST(self):
        if self.path != "/process":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        data = json.loads(body)
        img_bytes = base64.b64decode(data["image"])

        print(f"[Pipeline] Processing image ({len(img_bytes)} bytes)...")
        result = run_pipeline(img_bytes)
        if "steps" in result:
            print(f"[Pipeline] ✅ Generated {len(result['steps'])} steps")
        else:
            print(f"[Pipeline] ❌ {result.get('error', 'unknown error')}")

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(result).encode())


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"\n🔬 Preprocessing Pipeline Demo at http://localhost:{PORT}\n")
    server.serve_forever()
