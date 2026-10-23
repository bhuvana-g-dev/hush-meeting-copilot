/**
 * Meeting Copilot — In-Meeting Wingman Content Script
 * Runs directly on https://meet.google.com/*
 *
 * Responsibilities:
 * 1. Injects a floating / dockable in-meeting HUD overlay directly into Google Meet.
 * 2. Size Options: Standard (450px) / Large (530px) / Compact (380px) with 1-click toggle.
 * 3. Edge-Docking & Auto-Peek Mode:
 *    - Keeps copilot neatly aside at the right edge without disturbing the meeting video.
 *    - Continues listening to live speech in the background.
 *    - Automatically slides out when important updates arrive (Focus Alert or Hesitation-Buster Doubt).
 *    - Automatically slides back in when done (with hover-pause protection).
 * 4. 3-Tab Interface:
 *    - 🎯 Wingman: Real-time Focus/Zone-out recovery alerts & Hesitation-buster doubts.
 *    - 📝 Notes: Auto-extracted concepts, tools, action items + manual notes.
 *    - 📜 Transcript: Chronological live caption log with timestamps.
 * 5. 1-Click "Paste to Meet Chat" directly opens the chat drawer and inserts questions.
 * 6. 1-Click "📥 Export Notes & Transcript" downloads a clean Markdown file.
 * 7. Web Audio API chime for unobtrusive acoustic wake-up cues.
 */

"use strict";

// ── State ─────────────────────────────────────────────────────────────
let capturing = true;
let observer = null;
let currentGoal = "";
let soundEnabled = true;
let isMinimized = false;
let isDocked = true; // Default to edge-docked so it doesn't disturb meeting video
let isSlideOut = false; // Whether the docked drawer is currently popped out
let sizeMode = "standard"; // "standard" (450px) | "large" (530px) | "compact" (380px)
let activeTab = "wingman"; // "wingman" | "notes" | "transcript"

let autoDockTimer = null;
let autoDockCountdown = 14;
let isHoveringHUD = false;

// Session stores
let sessionNotes = [];
let sessionTranscript = [];
let activeWingmanRecord = null;

const lastText = new WeakMap();
const lastSpeaker = new WeakMap();
let lineBuffer = [];
let flushTimer = null;
const FLUSH_DELAY_MS = 2400;
const MAX_BUFFER_LINES = 6;
let lastSentText = "";

// ── Selectors for Google Meet captions & UI ───────────────────────────
const CAPTION_CONTAINER_SELECTORS = [
  '[data-caption-container]',
  '[jsname="tgaKEf"]',
  '[aria-label*="caption" i]',
  '[role="region"][aria-label*="caption" i]',
  '[jscontroller="D1tHje"]',
  'div[aria-live="polite"]',
  'div[aria-live="assertive"]',
  '.nMxvdc',
  '.a4cQT',
];

const SPEAKER_SELECTORS = [
  '[jsname="du16Kb"]',
  '[data-speaker-name]',
  '.a4cQT',
];

function findCaptionContainer() {
  for (const sel of CAPTION_CONTAINER_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// ── Audio chime helper (Web Audio API) ────────────────────────────────
function playChime() {
  if (!soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    // Audio context may require user interaction first
  }
}

// ── Google Meet Chat Helper ───────────────────────────────────────────
function pasteToMeetChat(text) {
  if (!text) return false;

  // 1. Try to find the chat input
  let chatInput = document.querySelector('textarea[aria-label*="Send a message" i], textarea[name="chatTextInput"], textarea[aria-label*="chat" i], div[contenteditable="true"][aria-label*="Send a message" i]');
  
  if (!chatInput) {
    // Open chat drawer
    const chatBtn = document.querySelector('button[aria-label*="chat" i], [data-panel-id="2"], button[aria-label*="Chat with everyone" i]');
    if (chatBtn) {
      chatBtn.click();
    }
  }

  // 2. Insert into chat input
  setTimeout(() => {
    chatInput = document.querySelector('textarea[aria-label*="Send a message" i], textarea[name="chatTextInput"], textarea[aria-label*="chat" i], div[contenteditable="true"][aria-label*="Send a message" i]');
    if (chatInput) {
      chatInput.focus();
      if (chatInput.tagName.toLowerCase() === "textarea" || chatInput.tagName.toLowerCase() === "input") {
        chatInput.value = text;
        chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        chatInput.textContent = text;
        chatInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    }
    // Fallback: clipboard
    navigator.clipboard.writeText(text);
  }, 300);

  return true;
}

// ── Export Notes & Transcript as Markdown ─────────────────────────────
function exportSessionMarkdown() {
  const dateStr = new Date().toLocaleDateString();
  const timeStr = new Date().toLocaleTimeString();
  
  let md = `# Meeting Copilot — Session Summary\n`;
  md += `**Date:** ${dateStr} at ${timeStr}\n`;
  md += `**Meeting Aim / Goal:** ${currentGoal || "General Meeting Tracking"}\n\n`;
  md += `---\n\n`;

  md += `## 📝 Structured Notes & Key Takeaways (${sessionNotes.length})\n\n`;
  if (sessionNotes.length === 0) {
    md += `_No notes recorded during this session._\n\n`;
  } else {
    const concepts = sessionNotes.filter(n => n.category === "Core Concept");
    const actions = sessionNotes.filter(n => n.category === "Action Item");
    const decisions = sessionNotes.filter(n => n.category === "Decision");
    const manuals = sessionNotes.filter(n => n.category === "User Note");

    if (concepts.length > 0) {
      md += `### ⚡ Core Concepts & Tools\n`;
      concepts.forEach(n => {
        md += `- **[${n.time || ''}] ${n.speaker || 'Speaker'}:** ${n.text}\n`;
      });
      md += `\n`;
    }

    if (actions.length > 0) {
      md += `### 📌 Action Items & Commitments\n`;
      actions.forEach(n => {
        md += `- [ ] **[${n.time || ''}] ${n.speaker || 'Speaker'}:** ${n.text}\n`;
      });
      md += `\n`;
    }

    if (decisions.length > 0) {
      md += `### 💡 Decisions & Key Points\n`;
      decisions.forEach(n => {
        md += `- **[${n.time || ''}] ${n.speaker || 'Speaker'}:** ${n.text}\n`;
      });
      md += `\n`;
    }

    if (manuals.length > 0) {
      md += `### ✍️ Attendee Personal Notes\n`;
      manuals.forEach(n => {
        md += `- **[${n.time || ''}]:** ${n.text}\n`;
      });
      md += `\n`;
    }
  }

  md += `---\n\n`;
  md += `## 📜 Full Spoken Transcript (${sessionTranscript.length} entries)\n\n`;
  if (sessionTranscript.length === 0) {
    md += `_No captions recorded._\n`;
  } else {
    sessionTranscript.forEach(t => {
      md += `\`[${t.time}]\` ${t.text}\n\n`;
    });
  }

  // Create download link
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `meeting-summary-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Inject Floating In-Meeting HUD Overlay ─────────────────────────────
function injectMeetingHUD() {
  if (document.getElementById("meet-copilot-hud-root")) return;

  const root = document.createElement("div");
  root.id = "meet-copilot-hud-root";
  root.className = `mc-size-${sizeMode} mc-docked`;
  root.innerHTML = `
    <style>
      #meet-copilot-hud-root {
        position: fixed !important;
        top: 20px !important;
        right: 20px !important;
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif !important;
        font-size: 13.5px !important;
        color: #f1f5f9 !important;
        display: block !important;
        visibility: visible !important;
        pointer-events: none !important;
        transition: right 0.25s ease, top 0.25s ease;
      }

      /* Edge-Docked State */
      #meet-copilot-hud-root.mc-docked {
        top: 14% !important;
        right: 0px !important;
        left: auto !important;
        display: flex !important;
        align-items: flex-start !important;
      }

      /* Edge Tab Handle (Visible when docked) */
      .mc-edge-tab {
        display: none;
        pointer-events: auto;
        cursor: pointer;
        background: rgba(15, 23, 42, 0.94);
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-right: none;
        border-radius: 10px 0 0 10px;
        padding: 10px 8px;
        box-shadow: -4px 6px 20px rgba(0, 0, 0, 0.5);
        color: #f1f5f9;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        user-select: none;
        transition: transform 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
      }
      #meet-copilot-hud-root.mc-docked .mc-edge-tab {
        display: flex;
      }
      .mc-edge-tab:hover {
        background: rgba(30, 41, 59, 0.98);
        box-shadow: -6px 8px 24px rgba(56, 189, 248, 0.35);
      }
      .mc-edge-tab.alerting {
        border-color: #f59e0b;
        animation: mc-edge-pulse 1s infinite alternate;
      }
      @keyframes mc-edge-pulse {
        from { box-shadow: -4px 0 16px rgba(245, 158, 11, 0.5); }
        to { box-shadow: -8px 0 30px rgba(245, 158, 11, 0.9); }
      }
      .mc-edge-text {
        writing-mode: vertical-rl;
        transform: rotate(180deg);
        font-size: 11.5px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #94a3b8;
      }
      .mc-edge-arrow {
        font-size: 12px;
        color: #38bdf8;
        transition: transform 0.25s ease;
      }

      /* Main HUD Window */
      .mc-hud {
        pointer-events: auto;
        background: rgba(15, 23, 42, 0.96);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 14px;
        box-shadow: 0 24px 50px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255,255,255,0.08);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: transform 0.38s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease, width 0.2s ease;
        max-height: 600px;
      }

      /* Width sizes */
      #meet-copilot-hud-root.mc-size-standard .mc-hud { width: 450px; }
      #meet-copilot-hud-root.mc-size-large .mc-hud    { width: 530px; }
      #meet-copilot-hud-root.mc-size-compact .mc-hud  { width: 380px; }

      /* When docked: HUD is tucked off-screen by default */
      #meet-copilot-hud-root.mc-docked .mc-hud {
        border-top-right-radius: 0;
        border-bottom-right-radius: 0;
        transform: translateX(100%);
      }
      /* When popped out in docked mode */
      #meet-copilot-hud-root.mc-docked .mc-hud.mc-slide-out {
        transform: translateX(0);
        box-shadow: -10px 24px 60px rgba(0, 0, 0, 0.75), 0 0 30px rgba(56, 189, 248, 0.25);
      }
      #meet-copilot-hud-root.mc-docked .mc-hud.mc-slide-out + .mc-edge-tab .mc-edge-arrow,
      #meet-copilot-hud-root.mc-docked .mc-edge-tab.is-open .mc-edge-arrow {
        transform: rotate(180deg);
      }

      /* Header Bar */
      .mc-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: rgba(30, 41, 59, 0.85);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        cursor: grab;
        user-select: none;
      }
      .mc-title {
        font-weight: 700;
        font-size: 14px;
        letter-spacing: -0.2px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .mc-pulse-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #22c55e;
        box-shadow: 0 0 8px #22c55e;
      }
      .mc-pulse-dot.waiting { background: #f59e0b; box-shadow: 0 0 8px #f59e0b; }
      .mc-pulse-dot.alerting { background: #eab308; animation: mc-blink 0.8s infinite; }
      @keyframes mc-blink { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.3; transform: scale(1.3); } }

      .mc-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 5px;
      }
      .mc-btn-hdr {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: #cbd5e1;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11.5px;
        font-weight: 600;
        transition: all 0.15s ease;
      }
      .mc-btn-hdr:hover { color: #fff; background: rgba(255, 255, 255, 0.18); }
      .mc-btn-hdr.active { background: rgba(56, 189, 248, 0.2); border-color: #38bdf8; color: #38bdf8; }

      /* Auto-Retreat Toast Banner */
      .mc-auto-retreat-bar {
        display: none;
        padding: 6px 14px;
        background: rgba(245, 158, 11, 0.16);
        border-bottom: 1px solid rgba(245, 158, 11, 0.3);
        font-size: 11.5px;
        color: #fde68a;
        align-items: center;
        justify-content: space-between;
      }
      .mc-auto-retreat-bar.active { display: flex; }
      .mc-auto-retreat-btn {
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.2);
        color: #fff;
        border-radius: 4px;
        padding: 2px 7px;
        font-size: 10.5px;
        cursor: pointer;
      }
      .mc-auto-retreat-btn:hover { background: rgba(255,255,255,0.2); }

      /* Navigation Tabs */
      .mc-tabs {
        display: flex;
        background: rgba(15, 23, 42, 0.92);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .mc-tab {
        flex: 1;
        padding: 9px 12px;
        text-align: center;
        font-size: 12px;
        font-weight: 600;
        color: #94a3b8;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }
      .mc-tab:hover { color: #f1f5f9; background: rgba(255,255,255,0.03); }
      .mc-tab.active {
        color: #38bdf8;
        border-bottom-color: #38bdf8;
        background: rgba(56, 189, 248, 0.06);
      }
      .mc-tab-badge {
        background: rgba(255,255,255,0.1);
        border-radius: 99px;
        padding: 1px 7px;
        font-size: 10.5px;
      }

      /* Tab Content Panels */
      .mc-tab-panel {
        display: none;
        flex-direction: column;
        flex: 1;
        overflow-y: auto;
      }
      .mc-tab-panel.active { display: flex; }

      /* Goal section inside Wingman tab */
      .mc-goal-sec {
        padding: 12px 16px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        background: rgba(15, 23, 42, 0.5);
      }
      .mc-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #94a3b8;
        margin-bottom: 6px;
        display: flex;
        justify-content: space-between;
      }
      .mc-goal-input-box {
        display: flex;
        gap: 8px;
      }
      .mc-input {
        flex: 1;
        background: rgba(30, 41, 59, 0.85);
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 8px;
        padding: 7px 11px;
        color: #fff;
        font-size: 12.5px;
        outline: none;
      }
      .mc-input:focus { border-color: #38bdf8; }
      .mc-btn-primary {
        background: #2563eb;
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 7px 14px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
        white-space: nowrap;
      }
      .mc-btn-primary:hover { background: #1d4ed8; }

      .mc-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-top: 8px;
      }
      .mc-chip {
        background: rgba(51, 65, 85, 0.6);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 99px;
        padding: 3px 9px;
        font-size: 11px;
        color: #cbd5e1;
        cursor: pointer;
      }
      .mc-chip:hover { background: rgba(59, 130, 246, 0.3); color: #93c5fd; }

      /* Wingman Feed Section */
      .mc-body {
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: 380px;
        overflow-y: auto;
      }

      .mc-card {
        border-radius: 12px;
        padding: 12px 14px;
        background: rgba(30, 41, 59, 0.7);
        border: 1px solid rgba(255,255,255,0.08);
        transition: all 0.25s ease;
      }
      .mc-card.focus-alert {
        background: rgba(245, 158, 11, 0.15);
        border: 1px solid #f59e0b;
        box-shadow: 0 0 20px rgba(245, 158, 11, 0.28);
        animation: mc-card-pop 0.3s ease;
      }
      .mc-card.ask-doubt {
        background: rgba(34, 197, 94, 0.15);
        border: 1px solid #22c55e;
        box-shadow: 0 0 20px rgba(34, 197, 94, 0.28);
        animation: mc-card-pop 0.3s ease;
      }
      .mc-card.goal-resolved {
        background: rgba(59, 130, 246, 0.15);
        border: 1px solid #3b82f6;
      }
      @keyframes mc-card-pop { from { transform: scale(0.97); opacity: 0.5; } to { transform: scale(1); opacity: 1; } }

      .mc-card-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 7px;
        font-weight: 700;
        font-size: 12.5px;
      }
      .mc-badge-focus { color: #f59e0b; }
      .mc-badge-doubt { color: #22c55e; }
      .mc-badge-resolved { color: #38bdf8; }

      .mc-card-summary {
        font-size: 13.5px;
        line-height: 1.5;
        color: #e2e8f0;
        margin-bottom: 10px;
      }
      .mc-doubt-quote {
        background: rgba(15, 23, 42, 0.8);
        border-left: 3px solid #22c55e;
        padding: 8px 12px;
        border-radius: 0 8px 8px 0;
        font-style: italic;
        font-size: 13px;
        line-height: 1.45;
        color: #ffffff;
        margin-bottom: 10px;
      }
      .mc-doubt-tip {
        font-size: 11.5px;
        color: #86efac;
        background: rgba(34, 197, 94, 0.12);
        border-radius: 6px;
        padding: 6px 10px;
        margin-bottom: 10px;
        line-height: 1.45;
      }

      .mc-btn-row {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
      }
      .mc-btn-sm {
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 6px;
        padding: 5px 11px;
        font-size: 12px;
        font-weight: 600;
        color: #e2e8f0;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 5px;
        transition: background 0.15s;
      }
      .mc-btn-sm:hover { background: rgba(255,255,255,0.2); color: #fff; }
      .mc-btn-sm.primary { background: #16a34a; border-color: #22c55e; }
      .mc-btn-sm.primary:hover { background: #15803d; }
      .mc-btn-sm.dock-now { background: rgba(15, 23, 42, 0.8); border-color: #94a3b8; }

      /* Notes Panel Styling */
      .mc-notes-bar {
        padding: 10px 16px;
        background: rgba(15, 23, 42, 0.4);
        border-bottom: 1px solid rgba(255,255,255,0.06);
        display: flex;
        gap: 6px;
      }
      .mc-notes-input {
        flex: 1;
        background: rgba(30, 41, 59, 0.8);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 12px;
        color: #fff;
        outline: none;
      }
      .mc-notes-list {
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 9px;
        max-height: 340px;
        overflow-y: auto;
      }
      .mc-note-item {
        background: rgba(30, 41, 59, 0.65);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 12.5px;
      }
      .mc-note-tag {
        font-size: 10.5px;
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 4px;
        display: flex;
        justify-content: space-between;
        color: #94a3b8;
      }
      .mc-note-tag.concept { color: #38bdf8; }
      .mc-note-tag.action { color: #f59e0b; }
      .mc-note-tag.decision { color: #22c55e; }

      /* Transcript Panel Styling */
      .mc-transcript-list {
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 7px;
        max-height: 380px;
        overflow-y: auto;
      }
      .mc-transcript-item {
        font-size: 12px;
        line-height: 1.45;
        color: #cbd5e1;
        padding: 5px 8px;
        border-radius: 5px;
        background: rgba(30, 41, 59, 0.35);
      }
      .mc-transcript-time {
        color: #64748b;
        font-size: 10.5px;
        font-family: monospace;
        margin-right: 5px;
      }

      /* Footer status */
      .mc-footer {
        padding: 8px 16px;
        background: rgba(15, 23, 42, 0.85);
        border-top: 1px solid rgba(255,255,255,0.06);
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11.5px;
        color: #64748b;
      }

      /* Collapsed Pill (when minimized) */
      .mc-pill {
        display: none;
        pointer-events: auto;
        cursor: pointer;
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(255,255,255,0.2);
        padding: 8px 16px;
        border-radius: 99px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 12.5px;
        transition: transform 0.15s ease;
      }
      .mc-pill:hover { transform: scale(1.04); }
      .mc-pill.has-alert {
        border-color: #f59e0b;
        animation: mc-pill-glow 1.5s infinite;
      }
      @keyframes mc-pill-glow { 0%, 100% { box-shadow: 0 0 10px rgba(245, 158, 11, 0.4); } 50% { box-shadow: 0 0 20px rgba(245, 158, 11, 0.8); } }
    </style>

    <!-- Edge Tab Handle (Visible on screen border when docked) -->
    <div id="mc-edge-tab" class="mc-edge-tab" title="Click to view Hush Copilot">
      <span class="mc-pulse-dot" id="mc-edge-dot"></span>
      <span class="mc-edge-text">🎯 HUSH AI</span>
      <span class="mc-edge-arrow" id="mc-edge-arrow">❮</span>
    </div>

    <!-- Collapsed Pill View (Alternate minimize option) -->
    <div id="mc-pill-view" class="mc-pill">
      <span class="mc-pulse-dot" id="mc-pill-dot"></span>
      <span id="mc-pill-text">🎯 Hush Copilot</span>
    </div>

    <!-- Main Expanded HUD -->
    <div id="mc-main-hud" class="mc-hud">
      <div class="mc-header" id="mc-drag-handle">
        <span class="mc-pulse-dot" id="mc-status-dot"></span>
        <span class="mc-title">🎯 Hush Copilot</span>
        <div class="mc-actions">
          <button class="mc-btn-hdr" id="mc-btn-size" title="Toggle Size (Standard / Large / Compact)">↔️ Size</button>
          <button class="mc-btn-hdr" id="mc-btn-dock" title="Dock to Side (Tucks aside until important updates)">🫸 Dock</button>
          <button class="mc-btn-hdr" id="mc-btn-export" title="Download Notes & Transcript">📥 Export</button>
          <button class="mc-btn-hdr" id="mc-toggle-sound" title="Toggle audio alert" style="padding:4px 6px;">🔔</button>
          <button class="mc-btn-hdr" id="mc-btn-min" title="Minimize to pill" style="padding:4px 6px;">─</button>
        </div>
      </div>

      <!-- Auto-Retreat Toast Banner (Appears when HUD auto-slides out on important updates) -->
      <div id="mc-auto-retreat-bar" class="mc-auto-retreat-bar">
        <span id="mc-retreat-text">⏱️ Auto-hiding in 14s (hover over window to keep open)</span>
        <button class="mc-auto-retreat-btn" id="mc-btn-retreat-now">❮ Tuck Aside</button>
      </div>

      <!-- Navigation Tabs -->
      <div class="mc-tabs">
        <div class="mc-tab active" data-tab="wingman" id="mc-tab-btn-wingman">
          🎯 Wingman
        </div>
        <div class="mc-tab" data-tab="notes" id="mc-tab-btn-notes">
          📝 Notes <span class="mc-tab-badge" id="mc-notes-badge">0</span>
        </div>
        <div class="mc-tab" data-tab="transcript" id="mc-tab-btn-transcript">
          📜 Transcript <span class="mc-tab-badge" id="mc-transcript-badge">0</span>
        </div>
      </div>

      <!-- TAB 1: WINGMAN -->
      <div class="mc-tab-panel active" id="mc-panel-wingman">
        <!-- Aim / Goal Setter -->
        <div class="mc-goal-sec">
          <div class="mc-label">
            <span>Your Aim / Learning Goal</span>
            <span id="mc-goal-status" style="color:#38bdf8;">Listening</span>
          </div>
          <div class="mc-goal-input-box">
            <input type="text" id="mc-goal-input" class="mc-input" placeholder="e.g. Master Full Stack Development, Learn Docker..." />
            <button id="mc-btn-save-goal" class="mc-btn-primary">Set Aim</button>
          </div>
          <div class="mc-chips">
            <span class="mc-chip" data-goal="Learn full stack development, React and backend APIs">🚀 Full Stack Dev</span>
            <span class="mc-chip" data-goal="Understand system architecture, database indexing and deployment">🛠️ Tech & Architecture</span>
            <span class="mc-chip" data-goal="Track project deliverables, blockers and deadlines">💼 Project Sync</span>
            <span class="mc-chip" data-goal="Capture technical interview questions and key concepts">🎯 Interview Prep</span>
          </div>
        </div>

        <!-- Live Wingman Card Feed -->
        <div class="mc-body" id="mc-card-feed">
          <div class="mc-card" id="mc-active-card">
            <div class="mc-card-header">
              <span>👂 Personal Wingman Active</span>
            </div>
            <div class="mc-card-summary" style="color:#94a3b8;">
              Set your goal above. When docked aside, your copilot listens quietly in the background and will automatically slide out only when important topics or questions arise!
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 2: NOTES -->
      <div class="mc-tab-panel" id="mc-panel-notes">
        <div class="mc-notes-bar">
          <input type="text" id="mc-manual-note-input" class="mc-notes-input" placeholder="Add your own quick note..." />
          <button id="mc-btn-add-note" class="mc-btn-primary" style="padding:5px 12px;font-size:11.5px;">Add</button>
        </div>
        <div class="mc-notes-list" id="mc-notes-container">
          <div style="font-size:12px;color:#94a3b8;text-align:center;padding:24px 0;">
            No notes yet. Concepts, decisions, and action items will automatically appear here as people speak.
          </div>
        </div>
      </div>

      <!-- TAB 3: TRANSCRIPT -->
      <div class="mc-tab-panel" id="mc-panel-transcript">
        <div class="mc-transcript-list" id="mc-transcript-container">
          <div style="font-size:12px;color:#94a3b8;text-align:center;padding:24px 0;">
            Captions will appear here chronologically once speech is detected.
          </div>
        </div>
      </div>

      <!-- Footer Info -->
      <div class="mc-footer">
        <span id="mc-cc-status">Captions: Checking...</span>
        <span>Strands Decider 2B</span>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  setupHUDInteractions();
}

// ── Setup HUD Click & Drag Handlers ────────────────────────────────────
function setupHUDInteractions() {
  const root = document.getElementById("meet-copilot-hud-root");
  const mainHud = document.getElementById("mc-main-hud");
  const edgeTab = document.getElementById("mc-edge-tab");
  const pillView = document.getElementById("mc-pill-view");
  const btnMin = document.getElementById("mc-btn-min");
  const btnDock = document.getElementById("mc-btn-dock");
  const btnSize = document.getElementById("mc-btn-size");
  const btnExport = document.getElementById("mc-btn-export");
  const toggleSound = document.getElementById("mc-toggle-sound");
  const goalInput = document.getElementById("mc-goal-input");
  const btnSaveGoal = document.getElementById("mc-btn-save-goal");
  const dragHandle = document.getElementById("mc-drag-handle");
  const btnRetreatNow = document.getElementById("mc-btn-retreat-now");

  // Load preferences from storage
  chrome.storage.local.get(["meeting_goal", "sound_enabled", "hud_size", "is_docked"], (data) => {
    if (data.meeting_goal) {
      currentGoal = data.meeting_goal;
      goalInput.value = currentGoal;
      updatePillText();
    }
    if (data.sound_enabled !== undefined) {
      soundEnabled = data.sound_enabled;
      toggleSound.textContent = soundEnabled ? "🔔" : "🔕";
    }
    if (data.hud_size) {
      sizeMode = data.hud_size;
      applySizeMode();
    }
    if (data.is_docked !== undefined) {
      isDocked = data.is_docked;
      applyDockState();
    } else {
      // Default to docked
      applyDockState();
    }
  });

  // Size cycle toggle: standard -> large -> compact -> standard
  btnSize.addEventListener("click", () => {
    if (sizeMode === "standard") sizeMode = "large";
    else if (sizeMode === "large") sizeMode = "compact";
    else sizeMode = "standard";

    applySizeMode();
    chrome.storage.local.set({ hud_size: sizeMode });
  });

  function applySizeMode() {
    root.classList.remove("mc-size-standard", "mc-size-large", "mc-size-compact");
    root.classList.add(`mc-size-${sizeMode}`);
    btnSize.textContent = sizeMode === "large" ? "🔍 Large" : sizeMode === "compact" ? "📱 Compact" : "↔️ Standard";
  }

  // Edge Tab Click (Pull out / Push in)
  edgeTab.addEventListener("click", () => {
    if (isSlideOut) {
      slideInHUD();
    } else {
      slideOutHUD();
    }
  });

  // Dock toggle button
  btnDock.addEventListener("click", () => {
    isDocked = !isDocked;
    applyDockState();
    chrome.storage.local.set({ is_docked: isDocked });
  });

  function applyDockState() {
    if (isDocked) {
      root.classList.add("mc-docked");
      btnDock.classList.add("active");
      btnDock.textContent = "📌 Aside";
      // Clear manual drag positioning
      root.style.top = "";
      root.style.left = "";
      root.style.right = "0px";
      slideInHUD();
    } else {
      root.classList.remove("mc-docked");
      btnDock.classList.remove("active");
      btnDock.textContent = "🫸 Dock";
      mainHud.classList.remove("mc-slide-out");
      cancelAutoDockCountdown();
    }
  }

  // Hover detection over HUD to pause auto-dock retreat
  mainHud.addEventListener("mouseenter", () => {
    isHoveringHUD = true;
    const retreatBar = document.getElementById("mc-auto-retreat-bar");
    const retreatText = document.getElementById("mc-retreat-text");
    if (retreatBar && retreatBar.classList.contains("active") && retreatText) {
      retreatText.textContent = "📌 Pinned open while mouse is hovering";
    }
  });

  mainHud.addEventListener("mouseleave", () => {
    isHoveringHUD = false;
    // If an alert is showing in docked mode, start graceful 5-second retreat
    if (isDocked && isSlideOut && autoDockCountdown > 0) {
      startAutoDockCountdown(5);
    }
  });

  // Immediate retreat button
  if (btnRetreatNow) {
    btnRetreatNow.addEventListener("click", () => {
      slideInHUD();
    });
  }

  // Tab switching
  const tabs = document.querySelectorAll(".mc-tab");
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".mc-tab-panel").forEach(p => p.classList.remove("active"));

      tab.classList.add("active");
      const targetId = `mc-panel-${tab.dataset.tab}`;
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add("active");
      activeTab = tab.dataset.tab;
    });
  });

  // Export button
  btnExport.addEventListener("click", () => {
    exportSessionMarkdown();
  });

  // Manual note addition
  const manualInput = document.getElementById("mc-manual-note-input");
  const btnAddNote = document.getElementById("mc-btn-add-note");
  if (btnAddNote && manualInput) {
    const handleAdd = () => {
      const text = manualInput.value.trim();
      if (!text) return;
      const note = {
        category: "User Note",
        icon: "✍️",
        text,
        speaker: "You",
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      sessionNotes.push(note);
      manualInput.value = "";
      renderNotesList();
      chrome.runtime.sendMessage({ type: "HUSH_SAVE_NOTE", note });
    };
    btnAddNote.addEventListener("click", handleAdd);
    manualInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleAdd();
    });
  }

  // Minimize to Pill / Expand toggles
  btnMin.addEventListener("click", () => {
    isMinimized = true;
    mainHud.style.display = "none";
    pillView.style.display = "flex";
  });

  pillView.addEventListener("click", () => {
    isMinimized = false;
    mainHud.style.display = "flex";
    pillView.style.display = "none";
    pillView.classList.remove("has-alert");
  });

  toggleSound.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    toggleSound.textContent = soundEnabled ? "🔔" : "🔕";
    chrome.storage.local.set({ sound_enabled: soundEnabled });
  });

  // Goal save
  btnSaveGoal.addEventListener("click", () => {
    saveGoal(goalInput.value.trim());
  });
  goalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveGoal(goalInput.value.trim());
  });

  // Preset chips
  document.querySelectorAll(".mc-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      goalInput.value = chip.dataset.goal;
      saveGoal(chip.dataset.goal);
    });
  });

  // Draggable HUD (Only active when NOT edge-docked)
  let isDragging = false;
  let startX, startY, origX, origY;

  dragHandle.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
    if (isDocked) {
      // Dragging out of dock undocks it
      isDocked = false;
      applyDockState();
      chrome.storage.local.set({ is_docked: false });
    }

    isDragging = true;
    dragHandle.style.cursor = "grabbing";
    startX = e.clientX;
    startY = e.clientY;
    const rect = root.getBoundingClientRect();
    origX = rect.left;
    origY = rect.top;
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    root.style.top = `${Math.max(10, origY + dy)}px`;
    root.style.left = `${Math.max(10, origX + dx)}px`;
    root.style.right = "auto";
  });

  window.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      dragHandle.style.cursor = "grab";
    }
  });
}

// ── Dock Slide In & Out Helpers ───────────────────────────────────────
function slideOutHUD() {
  const mainHud = document.getElementById("mc-main-hud");
  const edgeTab = document.getElementById("mc-edge-tab");
  if (mainHud) mainHud.classList.add("mc-slide-out");
  if (edgeTab) edgeTab.classList.add("is-open");
  isSlideOut = true;
}

function slideInHUD() {
  const mainHud = document.getElementById("mc-main-hud");
  const edgeTab = document.getElementById("mc-edge-tab");
  const retreatBar = document.getElementById("mc-auto-retreat-bar");
  if (mainHud) mainHud.classList.remove("mc-slide-out");
  if (edgeTab) {
    edgeTab.classList.remove("is-open");
    edgeTab.classList.remove("alerting");
  }
  if (retreatBar) retreatBar.classList.remove("active");
  cancelAutoDockCountdown();
  isSlideOut = false;
}

function startAutoDockCountdown(seconds) {
  cancelAutoDockCountdown();
  autoDockCountdown = seconds;

  const retreatBar = document.getElementById("mc-auto-retreat-bar");
  const retreatText = document.getElementById("mc-retreat-text");
  if (retreatBar) retreatBar.classList.add("active");

  const tick = () => {
    if (isHoveringHUD) return; // Do not decrement while user is hovering!

    autoDockCountdown--;
    if (retreatText) {
      retreatText.textContent = `⏱️ Auto-hiding in ${autoDockCountdown}s (hover to keep open)`;
    }

    if (autoDockCountdown <= 0) {
      slideInHUD();
    }
  };

  if (retreatText) retreatText.textContent = `⏱️ Auto-hiding in ${autoDockCountdown}s (hover to keep open)`;
  autoDockTimer = setInterval(tick, 1000);
}

function cancelAutoDockCountdown() {
  if (autoDockTimer) {
    clearInterval(autoDockTimer);
    autoDockTimer = null;
  }
}

function saveGoal(goal) {
  currentGoal = goal;
  const statusEl = document.getElementById("mc-goal-status");
  if (statusEl) statusEl.textContent = goal ? "Aim Locked" : "No Aim";
  chrome.runtime.sendMessage({ type: "HUSH_SET_GOAL", goal });
  updatePillText();

  // Reset feed
  renderActiveCard({
    nudge_type: "STAY_SILENT",
    wake_up_summary: goal ? `Aim locked: "${goal}". Listening quietly in the background...` : "Monitoring live speech.",
  });
}

function updatePillText() {
  const pillText = document.getElementById("mc-pill-text");
  if (pillText) {
    pillText.textContent = currentGoal ? `🎯 Aim: ${currentGoal.slice(0, 24)}...` : "🎯 Hush Copilot";
  }
}

// ── Render Notes List ─────────────────────────────────────────────────
function renderNotesList() {
  const container = document.getElementById("mc-notes-container");
  const badge = document.getElementById("mc-notes-badge");
  if (!container) return;

  if (badge) badge.textContent = sessionNotes.length;

  if (sessionNotes.length === 0) {
    container.innerHTML = `
      <div style="font-size:12px;color:#94a3b8;text-align:center;padding:24px 0;">
        No notes yet. Concepts, decisions, and action items will automatically appear here as people speak.
      </div>
    `;
    return;
  }

  container.innerHTML = sessionNotes.slice().reverse().map(n => {
    const catClass = (n.category || "").toLowerCase().includes("action") ? "action"
      : (n.category || "").toLowerCase().includes("decision") ? "decision" : "concept";
    const icon = n.icon === "action" || (n.category || "").includes("Action") ? "📌"
      : n.icon === "decision" || (n.category || "").includes("Decision") ? "💡"
      : n.icon === "concept" || (n.category || "").includes("Concept") ? "⚡"
      : n.icon === "User Note" || (n.category || "").includes("User") ? "✍️"
      : (typeof n.icon === "string" && n.icon.length <= 2 ? n.icon : "📌");
    return `
      <div class="mc-note-item">
        <div class="mc-note-tag ${catClass}">
          <span>${icon} ${n.category || 'Note'}</span>
          <span>${n.time || ''}</span>
        </div>
        <div style="color:#f1f5f9;line-height:1.45;">${n.text}</div>
        ${n.speaker ? `<div style="font-size:10.5px;color:#94a3b8;margin-top:4px;">— ${n.speaker}</div>` : ''}
      </div>
    `;
  }).join("");
}

// ── Render Transcript List ───────────────────────────────────────────
function renderTranscriptList() {
  const container = document.getElementById("mc-transcript-container");
  const badge = document.getElementById("mc-transcript-badge");
  if (!container) return;

  if (badge) badge.textContent = sessionTranscript.length;

  if (sessionTranscript.length === 0) {
    container.innerHTML = `
      <div style="font-size:12px;color:#94a3b8;text-align:center;padding:24px 0;">
        Captions will appear here chronologically once speech is detected.
      </div>
    `;
    return;
  }

  container.innerHTML = sessionTranscript.slice(-45).map(t => `
    <div class="mc-transcript-item">
      <span class="mc-transcript-time">[${t.time}]</span>
      <span>${t.text}</span>
    </div>
  `).join("");

  // Auto scroll to bottom
  container.scrollTop = container.scrollHeight;
}

// ── Render Live Wingman Cards ──────────────────────────────────────────
function renderActiveCard(record) {
  const feed = document.getElementById("mc-card-feed");
  const pillView = document.getElementById("mc-pill-view");
  const dot = document.getElementById("mc-status-dot");
  const pillDot = document.getElementById("mc-pill-dot");
  const edgeTab = document.getElementById("mc-edge-tab");
  const edgeDot = document.getElementById("mc-edge-dot");
  if (!feed) return;

  activeWingmanRecord = record;
  const nudge = record.nudge_type || "STAY_SILENT";
  const speaker = record.speaker || "Speaker";
  const summary = record.wake_up_summary || "";
  const doubt = record.suggested_doubt || "";
  const doubtTip = record.doubt_tip || "Don't hesitate to ask! Asking now clarifies concepts and keeps you 100% on track!";
  const questions = record.suggested_questions || [];
  const reason = record.reason || "";

  let cardHtml = "";

  if (nudge === "FOCUS_ALERT") {
    playChime();
    if (dot) dot.className = "mc-pulse-dot alerting";
    if (pillDot) pillDot.className = "mc-pulse-dot alerting";
    if (edgeDot) edgeDot.className = "mc-pulse-dot alerting";
    if (pillView) pillView.classList.add("has-alert");
    if (edgeTab) edgeTab.classList.add("alerting");

    // Automatically slide out from edge if docked!
    if (isDocked) {
      slideOutHUD();
      startAutoDockCountdown(14);
    }

    cardHtml = `
      <div class="mc-card focus-alert">
        <div class="mc-card-header mc-badge-focus">
          <span>⚡ CONTEXT ALERT (Wake Up!)</span>
        </div>
        <div class="mc-card-summary">
          <strong>${speaker}</strong> is discussing your topic:
          <div style="margin-top:6px;font-weight:500;">${summary}</div>
        </div>
        ${reason ? `<div style="font-size:11.5px;color:#cbd5e1;margin-bottom:8px;">💡 ${reason}</div>` : ""}
        <div class="mc-btn-row">
          <button class="mc-btn-sm dock-now" id="mc-btn-dismiss-alert">❮ Tuck Aside</button>
        </div>
      </div>
    `;
  } else if (nudge === "ASK_DOUBT") {
    playChime();
    if (dot) dot.className = "mc-pulse-dot alerting";
    if (pillDot) pillDot.className = "mc-pulse-dot alerting";
    if (edgeDot) edgeDot.className = "mc-pulse-dot alerting";
    if (pillView) pillView.classList.add("has-alert");
    if (edgeTab) edgeTab.classList.add("alerting");

    // Automatically slide out from edge if docked!
    if (isDocked) {
      slideOutHUD();
      startAutoDockCountdown(18); // Generous time to read and ask
    }

    cardHtml = `
      <div class="mc-card ask-doubt">
        <div class="mc-card-header mc-badge-doubt">
          <span>🎤 ASK YOUR QUESTION NOW</span>
        </div>
        <div class="mc-card-summary">
          <strong>${speaker}</strong> just paused or opened the floor.
        </div>
        <div class="mc-doubt-tip">💡 ${doubtTip.replace(/^💡\s*/, "")}</div>
        <div class="mc-doubt-quote" id="mc-doubt-text">"${doubt || `Could you clarify how this connects to ${currentGoal}?`}"</div>
        <div class="mc-btn-row">
          <button class="mc-btn-sm primary" id="mc-btn-copy-doubt">📋 Copy Question</button>
          <button class="mc-btn-sm" id="mc-btn-paste-chat">💬 Paste to Meet Chat</button>
          <button class="mc-btn-sm" id="mc-btn-mark-asked">✅ Mark Asked</button>
          <button class="mc-btn-sm dock-now" id="mc-btn-dismiss-alert">❮ Tuck Aside</button>
        </div>
        ${questions.length > 0 ? `
          <div style="margin-top:10px;font-size:11.5px;color:#94a3b8;font-weight:600;">Alternative questions:</div>
          <div style="display:flex;flex-direction:column;gap:5px;margin-top:5px;">
            ${questions.map(q => `
              <div class="mc-btn-sm mc-alt-q" style="font-size:11.5px;cursor:pointer;" title="Click to use this question">${q}</div>
            `).join("")}
          </div>
        ` : ''}
      </div>
    `;
  } else if (nudge === "GOAL_RESOLVED") {
    playChime();
    if (isDocked) {
      slideOutHUD();
      startAutoDockCountdown(10);
    }
    cardHtml = `
      <div class="mc-card goal-resolved">
        <div class="mc-card-header mc-badge-resolved">
          <span>🎉 GOAL ADDRESSED</span>
        </div>
        <div class="mc-card-summary">
          ${summary || "Your meeting goal appears to have been answered in this discussion."}
        </div>
        <div class="mc-btn-row">
          <button class="mc-btn-sm dock-now" id="mc-btn-dismiss-alert">❮ Tuck Aside</button>
        </div>
      </div>
    `;
  } else {
    // Routine talk
    if (dot) dot.className = "mc-pulse-dot";
    if (pillDot) pillDot.className = "mc-pulse-dot";
    if (edgeDot) edgeDot.className = "mc-pulse-dot";

    cardHtml = `
      <div class="mc-card">
        <div class="mc-card-header">
          <span>👂 Monitoring Meeting</span>
        </div>
        <div class="mc-card-summary" style="color:#94a3b8;">
          ${summary || (currentGoal ? `Listening quietly for: "${currentGoal}". Conversation is currently routine.` : "Monitoring live speech.")}
        </div>
      </div>
    `;
  }

  feed.innerHTML = cardHtml;

  // Bind dismiss/tuck button
  const dismissBtn = document.getElementById("mc-btn-dismiss-alert");
  if (dismissBtn) {
    dismissBtn.addEventListener("click", () => {
      slideInHUD();
    });
  }

  // Bind doubt card buttons if rendered
  const copyBtn = document.getElementById("mc-btn-copy-doubt");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const text = doubt || (document.getElementById("mc-doubt-text") ? document.getElementById("mc-doubt-text").textContent.replace(/"/g, "") : "");
      navigator.clipboard.writeText(text);
      copyBtn.textContent = "✓ Copied!";
      setTimeout(() => { copyBtn.textContent = "📋 Copy Question"; }, 2000);
    });
  }

  const pasteBtn = document.getElementById("mc-btn-paste-chat");
  if (pasteBtn) {
    pasteBtn.addEventListener("click", () => {
      const text = doubt || (document.getElementById("mc-doubt-text") ? document.getElementById("mc-doubt-text").textContent.replace(/"/g, "") : "");
      pasteToMeetChat(text);
      pasteBtn.textContent = "✓ Inserted in Chat";
      setTimeout(() => { pasteBtn.textContent = "💬 Paste to Meet Chat"; }, 2500);
    });
  }

  const markBtn = document.getElementById("mc-btn-mark-asked");
  if (markBtn) {
    markBtn.addEventListener("click", () => {
      renderActiveCard({
        nudge_type: "GOAL_RESOLVED",
        wake_up_summary: "You asked your question! Copilot will continue tracking the response."
      });
      setTimeout(() => {
        if (isDocked) slideInHUD();
      }, 2500);
    });
  }

  // Bind alternative question clicks
  document.querySelectorAll(".mc-alt-q").forEach(el => {
    el.addEventListener("click", () => {
      const chosen = el.textContent.trim();
      const quoteEl = document.getElementById("mc-doubt-text");
      if (quoteEl) quoteEl.textContent = `"${chosen}"`;
      pasteToMeetChat(chosen);
    });
  });
}

// ── Ultra-Resilient Google Meet Captions Capture Engine ──────────────
let liveUtterance = { speaker: "", text: "", timer: null };
let activeScanInterval = null;
const UTTERANCE_FINALIZE_DELAY_MS = 1000; // Finalize sentence 1.0s after speaker pauses

function startObserving() {
  if (observer) return;

  const ccStatusEl = document.getElementById("mc-cc-status");
  if (ccStatusEl) ccStatusEl.innerHTML = '<span style="color:#22c55e;">CC Connected</span>';
  sendStatus("connected");

  // 1. Observe entire document body for any caption additions/updates
  observer = new MutationObserver((mutations) => {
    if (!capturing) return;
    for (const m of mutations) {
      // Ignore mutations originating from our own HUD
      if (m.target && m.target.closest && m.target.closest("#meet-copilot-hud-root")) continue;
      scanForCaptions();
      break;
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // 2. High-reliability polling fallback every 500ms
  if (!activeScanInterval) {
    activeScanInterval = setInterval(() => {
      if (capturing) scanForCaptions();
    }, 500);
  }
}

function stopObserving() {
  if (observer) { observer.disconnect(); observer = null; }
  if (activeScanInterval) { clearInterval(activeScanInterval); activeScanInterval = null; }
  flushBuffer(true);
  sendStatus("idle");
}

function scanForCaptions() {
  if (!capturing) return;

  // Search all possible caption & aria-live regions
  const regions = document.querySelectorAll(
    '[aria-live="polite"], [jsname="YSg9Nc"], .nMcdL, .a4cQT, [jsname="tgaKEf"], .ygicle, .VbkSUe, div[data-caption-container]'
  );

  let bestCaption = null;

  regions.forEach(region => {
    if (region.closest("#meet-copilot-hud-root")) return;

    const raw = (region.innerText || region.textContent || "").trim();
    if (!raw || raw.length < 5) return;

    // Filter out Google Meet system prompts & banners
    if (
      raw.includes("Your meeting's ready") ||
      raw.includes("meet.google.com") ||
      raw.includes("Add others") ||
      raw.includes("joined as") ||
      raw.includes("Joined as") ||
      raw.includes("Turn on") ||
      raw.includes("Raise hand") ||
      raw.includes("Chat with everyone")
    ) {
      return;
    }

    // Extract speaker and text body
    let speaker = "You";
    let body = raw;

    // Pattern 1: Multi-line where first line is speaker name (e.g. "You\nHello everyone...")
    const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length >= 2 && lines[0].length < 35 && !/[.?!]/.test(lines[0])) {
      speaker = lines[0];
      body = lines.slice(1).join(" ");
    } else {
      // Pattern 2: "Speaker: Text"
      const colonMatch = raw.match(/^([A-Za-z0-9 ]{1,30}):\s*(.+)/s);
      if (colonMatch) {
        speaker = colonMatch[1];
        body = colonMatch[2];
      }
    }

    // Clean up repeated speaker prefix
    if (speaker && body.startsWith(speaker)) {
      body = body.slice(speaker.length).trim();
    }

    if (body && body.length > 3) {
      // Prefer the longer/more complete utterance
      if (!bestCaption || body.length >= bestCaption.text.length) {
        bestCaption = { speaker, text: body };
      }
    }
  });

  const ccStatusEl = document.getElementById("mc-cc-status");

  if (bestCaption) {
    if (ccStatusEl) ccStatusEl.innerHTML = '<span style="color:#22c55e;">CC Connected (Speech Active)</span>';
    processLiveText(bestCaption.speaker, bestCaption.text);
  } else {
    if (ccStatusEl) ccStatusEl.innerHTML = '<span style="color:#22c55e;">CC Connected</span>';
    // If subtitle was cleared from screen and we have uncommitted utterance, finalize immediately!
    if (liveUtterance.text) {
      finalizeLiveUtterance();
    }
  }
}

function processLiveText(speaker, text) {
  const clean = text.trim();
  if (!clean || clean === lastSentText) return;

  // If text has not changed since last scan, do NOT restart the debounce timer!
  if (clean === liveUtterance.text && speaker === liveUtterance.speaker) {
    return;
  }

  // If speaker changed, immediately commit whatever the previous speaker said
  if (liveUtterance.speaker && liveUtterance.speaker !== speaker && liveUtterance.text) {
    finalizeLiveUtterance();
  }

  liveUtterance.speaker = speaker;
  liveUtterance.text = clean;

  // Commit once the speaker finishes speaking or pauses for 800ms
  clearTimeout(liveUtterance.timer);
  liveUtterance.timer = setTimeout(() => {
    finalizeLiveUtterance();
  }, 800);
}

function finalizeLiveUtterance() {
  clearTimeout(liveUtterance.timer);
  const text = (liveUtterance.text || "").trim();
  const speaker = liveUtterance.speaker || "Speaker";

  if (!text || text === lastSentText || text.length < 3) return;

  lastSentText = text;
  liveUtterance = { speaker: "", text: "", timer: null };

  commitLine(speaker, text);
}

function commitLine(speaker, text) {
  const clean = text.trim();
  if (!clean) return;

  const line = speaker && speaker !== "Speaker" ? `[${speaker}]: ${clean}` : clean;
  lineBuffer.push(line);

  // Add to in-memory live transcript
  sessionTranscript.push({
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    text: line,
  });
  renderTranscriptList();

  // Send to AI immediately
  flushBuffer(false);
}

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushBuffer(false), 300);
}

function flushBuffer(force) {
  clearTimeout(flushTimer);
  if (lineBuffer.length === 0) return;
  const segment = lineBuffer.join("\n");
  lineBuffer = [];

  chrome.runtime.sendMessage({
    type: "HUSH_SEGMENT",
    segment,
    goal: currentGoal,
    ts: Date.now(),
  });
}

// ── Messages from Background / Popup ──────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "WINGMAN_NUDGE" && msg.record) {
    const cc = document.getElementById("mc-cc-status");
    if (cc) cc.innerHTML = '<span style="color:#22c55e;">CC Connected (AI Active)</span>';
    renderActiveCard(msg.record);
    if (msg.sessionNotes && Array.isArray(msg.sessionNotes)) {
      sessionNotes = msg.sessionNotes;
      renderNotesList();
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "WINGMAN_STATUS") {
    const cc = document.getElementById("mc-cc-status");
    if (cc && msg.message) {
      cc.innerHTML = `<span style="color:#38bdf8;">${msg.message}</span>`;
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "WINGMAN_GOAL_UPDATED") {
    currentGoal = msg.goal || "";
    const input = document.getElementById("mc-goal-input");
    if (input) input.value = currentGoal;
    const statusEl = document.getElementById("mc-goal-status");
    if (statusEl) statusEl.textContent = currentGoal ? "Aim Locked" : "No Aim";
    updatePillText();

    if (msg.notes && Array.isArray(msg.notes)) {
      sessionNotes = msg.notes;
      renderNotesList();
    }
    if (msg.transcript && Array.isArray(msg.transcript)) {
      sessionTranscript = msg.transcript;
      renderTranscriptList();
    }

    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "WINGMAN_ERROR") {
    const cc = document.getElementById("mc-cc-status");
    if (cc) cc.innerHTML = `<span style="color:#ef4444;" title="${msg.message}">Backend error</span>`;
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "HUSH_START") {
    capturing = true;
    startObserving();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "HUSH_STOP") {
    capturing = false;
    stopObserving();
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "HUSH_STATUS_REQ") {
    sendResponse({
      capturing,
      hasContainer: !!findCaptionContainer(),
      goal: currentGoal,
    });
    return true;
  }
});

function sendStatus(status) {
  chrome.runtime.sendMessage({ type: "HUSH_CONTENT_STATUS", status }).catch(() => {});
}

// ── Initialise on Google Meet ─────────────────────────────────────────
function init() {
  injectMeetingHUD();
  startObserving();
  setInterval(() => {
    if (!document.getElementById("meet-copilot-hud-root")) {
      injectMeetingHUD();
    }
  }, 2000);
  chrome.runtime.sendMessage({ type: "HUSH_CONTENT_READY" }).catch(() => {});
}

// Run when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
