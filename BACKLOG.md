# Jewelry Sketch → Studio — Product Backlog

_Last updated: 2026-02-14_

---

## 🔴 High Priority (Next Up)

### 1. Sketch Preprocessing Pipeline
- Clean background to pure white before sending to API
- Edge enhancement / adaptive thresholding for hand-drawn sketches
- Contrast normalization (CLAHE)
- Auto-rotation / skew correction
- Resolution upscaling if input < 1024px (Real-ESRGAN or similar)
- **Why:** Cleaner input = more faithful output. The model reasons better on clean sketches.

### 2. Automated QA via Gemini Text Model
- After image generation, run a separate Gemini text call on the output
- Verify: gemstone count matches sketch, no extra elements added, proportions preserved
- Auto-flag mismatches to the user before they have to visually check
- Optional: auto-retry with corrective prompt if QA fails (up to 3x)
- **Why:** Zero-hallucination is the #1 requirement. Automated checks catch errors humans miss.

### 3. Reference Image Support
- Allow optional second image upload per slot (style/material reference)
- Label images explicitly in prompt: "Image 1 = design sketch, Image 2 = style reference only"
- Model supports up to 14 input images — huge opportunity
- **Why:** Showing the model a real gold ring photo alongside a sketch dramatically improves material rendering.

---

## 🟡 Medium Priority

### 4. Multi-Turn Conversation History
- Currently refine is single-turn (original → result → refinement)
- Support chained refinements (refine → refine → refine) with full conversation history
- Preserve thought signatures across the full chain
- **Why:** Complex jewelry pieces may need 3-4 iterations to get perfect.

### 5. Batch Processing / CSV Upload
- Upload a folder of sketches, assign category/metal, generate all
- Export results as a zip
- **Why:** For production use (catalog generation), one-by-one is too slow.

### 6. Prompt Library / Templates
- Save & load prompt templates per category
- Pre-built prompts optimized for each jewelry type (ring angles, necklace draping, etc.)
- Community-shared templates
- **Why:** Users shouldn't have to write prompts from scratch every time.

### 7. Side-by-Side Comparison
- Show sketch vs. generated image side by side with sync zoom/pan
- Overlay toggle (semi-transparent sketch over result) for fidelity checking
- **Why:** Makes visual QA 10x faster.

---

## 🟢 Nice to Have / Research

### 8. ControlNet Fallback Pipeline
- If Gemini fails fidelity after 3 retries, fall back to ControlNet + SDXL
- Canny edge extraction → ControlNet conditioning → jewelry LoRA
- Hybrid approach: Gemini for reasoning, ControlNet for structural fidelity
- **Research needed:** Cost/latency tradeoff, self-hosted vs API (FAL.ai, Replicate)

### 9. 2K/4K Output
- Nano Banana Pro supports up to 4096px output
- Research how to request higher resolution (may need Vertex AI, not free-tier)
- **Why:** E-commerce catalogs need high-res images.

### 10. Style Transfer / Consistent Branding
- Save a "brand style" (lighting, background, angle preferences)
- Apply consistently across all generations
- **Research needed:** Can multi-image input enforce a consistent style?

### 11. Video / 360° Spin
- Generate multiple angles of the same piece
- Stitch into a 360° product spin or short video
- **Research needed:** Does Gemini maintain consistency across angle prompts?

### 12. Mobile App / WhatsApp Bot
- Send sketch via WhatsApp → get photorealistic render back
- Low-friction for jewelry manufacturers who aren't tech-savvy
- **Why:** Pranshu's target users (B2B jewelry) often use WhatsApp as primary tool.

### 13. Pricing / Monetization Research
- Cost per generation (input tokens + thinking tokens + output tokens + image)
- Sustainable pricing model for SaaS (per-image? subscription? tiered?)
- Compare with Quicklens pricing strategy

---

## 🔬 Research Items

| Topic | Status | Notes |
|-------|--------|-------|
| Sketch preprocessing (OpenCV/rembg) | Not started | Python or WASM in browser? |
| Gemini text QA for gemstone counting | Not started | Separate API call, cheap |
| ControlNet + jewelry LoRA feasibility | Not started | FAL.ai or Replicate |
| 4K output via Vertex AI | Not started | May need billing/project setup |
| Thought signatures documentation | Partially done | Confirmed working in API |
| Competitor analysis (jewelry AI tools) | Not started | Who else is doing this? |
| User testing with real jewelers | Not started | Get Pranshu's contacts to test |

---

_Pranshu: ping Sash anytime to review this backlog. I'll also remind you periodically._
