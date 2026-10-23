/**
 * Meeting Copilot — In-Meeting Wingman Content Script
 * Runs directly on https://meet.google.com/*
 *
 * Responsibilities:
 * 1. Injects a floating, draggable in-meeting HUD overlay directly into Google Meet.
 * 2. 3-Tab Interface:
 *    - 🎯 Wingman: Real-time Focus/Zone-out recovery alerts & Hesitation-buster doubts.
 *    - 📝 Notes: Auto-extracted concepts, tools, action items + manual notes.
 *    - 📜 Transcript: Chronological live caption log with timestamps.
 * 3. 1-Click "Paste to Meet Chat" directly opens the chat drawer and inserts questions.
 * 4. 1-Click "📥 Export Notes & Transcript" downloads a clean Markdown file.
 * 5. Web Audio API chime for unobtrusive acoustic wake-up cues.
 */

"use strict";

// ── State ─────────────────────────────────────────────────────────────
let capturing = true;
let observer = null;
let currentGoal = "";
let soundEnabled = true;
let isMinimized = false;
let activeTab = "wingman"; // "wingman" | "notes" | "transcript"

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
  root.innerHTML = `
    <style>
      #meet-copilot-hud-root {
        position: fixed !important;
        top: 24px !important;
        right: 24px !important;
        z-index: 2147483647 !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif !important;
        font-size: 13px !important;
        color: #f1f5f9 !important;
        display: block !important;
        visibility: visible !important;
        pointer-events: none !important;
      }
      .mc-hud {
        pointer-events: auto;
        width: 380px;
        max-height: 580px;
        background: rgba(15, 23, 42, 0.96);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 14px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255,255,255,0.06);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: transform 0.2s ease, opacity 0.2s ease;
      }
      .mc-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        background: rgba(30, 41, 59, 0.8);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        cursor: grab;
        user-select: none;
      }
      .mc-title {
        font-weight: 700;
        font-size: 13px;
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
      .mc-btn-icon {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
      }
      .mc-btn-icon:hover { color: #fff; background: rgba(255,255,255,0.1); }
      .mc-btn-export-hdr {
        background: rgba(56, 189, 248, 0.15);
        color: #38bdf8;
        border: 1px solid rgba(56, 189, 248, 0.3);
        border-radius: 6px;
        padding: 3px 8px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .mc-btn-export-hdr:hover { background: rgba(56, 189, 248, 0.25); color: #fff; }

      /* Tabs Bar */
      .mc-tabs {
        display: flex;
        background: rgba(15, 23, 42, 0.9);
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .mc-tab {
        flex: 1;
        padding: 8px 10px;
        text-align: center;
        font-size: 11px;
        font-weight: 600;
        color: #94a3b8;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
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
        padding: 1px 6px;
        font-size: 10px;
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
        padding: 10px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        background: rgba(15, 23, 42, 0.5);
      }
      .mc-label {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #94a3b8;
        margin-bottom: 5px;
        display: flex;
        justify-content: space-between;
      }
      .mc-goal-input-box {
        display: flex;
        gap: 6px;
      }
      .mc-input {
        flex: 1;
        background: rgba(30, 41, 59, 0.85);
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 8px;
        padding: 6px 10px;
        color: #fff;
        font-size: 12px;
        outline: none;
      }
      .mc-input:focus { border-color: #38bdf8; }
      .mc-btn-primary {
        background: #2563eb;
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 6px 12px;
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
        gap: 4px;
        margin-top: 6px;
      }
      .mc-chip {
        background: rgba(51, 65, 85, 0.6);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 99px;
        padding: 2px 8px;
        font-size: 10px;
        color: #cbd5e1;
        cursor: pointer;
      }
      .mc-chip:hover { background: rgba(59, 130, 246, 0.3); color: #93c5fd; }

      /* Wingman Feed Section */
      .mc-body {
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: 360px;
        overflow-y: auto;
      }

      .mc-card {
        border-radius: 10px;
        padding: 10px 12px;
        background: rgba(30, 41, 59, 0.7);
        border: 1px solid rgba(255,255,255,0.08);
        transition: all 0.25s ease;
      }
      .mc-card.focus-alert {
        background: rgba(245, 158, 11, 0.14);
        border: 1px solid #f59e0b;
        box-shadow: 0 0 18px rgba(245, 158, 11, 0.25);
        animation: mc-card-pop 0.3s ease;
      }
      .mc-card.ask-doubt {
        background: rgba(34, 197, 94, 0.14);
        border: 1px solid #22c55e;
        box-shadow: 0 0 18px rgba(34, 197, 94, 0.25);
        animation: mc-card-pop 0.3s ease;
      }
      .mc-card.goal-resolved {
        background: rgba(59, 130, 246, 0.14);
        border: 1px solid #3b82f6;
      }
      @keyframes mc-card-pop { from { transform: scale(0.97); opacity: 0.5; } to { transform: scale(1); opacity: 1; } }

      .mc-card-header {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 6px;
        font-weight: 700;
        font-size: 12px;
      }
      .mc-badge-focus { color: #f59e0b; }
      .mc-badge-doubt { color: #22c55e; }
      .mc-badge-resolved { color: #38bdf8; }

      .mc-card-summary {
        font-size: 12px;
        line-height: 1.45;
        color: #e2e8f0;
        margin-bottom: 8px;
      }
      .mc-doubt-quote {
        background: rgba(15, 23, 42, 0.75);
        border-left: 3px solid #22c55e;
        padding: 7px 10px;
        border-radius: 0 6px 6px 0;
        font-style: italic;
        font-size: 12px;
        color: #f8fafc;
        margin-bottom: 8px;
      }
      .mc-doubt-tip {
        font-size: 11px;
        color: #86efac;
        background: rgba(34, 197, 94, 0.1);
        border-radius: 6px;
        padding: 5px 8px;
        margin-bottom: 8px;
        line-height: 1.4;
      }

      .mc-btn-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .mc-btn-sm {
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 6px;
        padding: 4px 9px;
        font-size: 11px;
        font-weight: 600;
        color: #e2e8f0;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
        transition: background 0.15s;
      }
      .mc-btn-sm:hover { background: rgba(255,255,255,0.18); color: #fff; }
      .mc-btn-sm.primary { background: #16a34a; border-color: #22c55e; }
      .mc-btn-sm.primary:hover { background: #15803d; }

      /* Notes Panel Styling */
      .mc-notes-bar {
        padding: 8px 14px;
        background: rgba(15, 23, 42, 0.4);
        border-bottom: 1px solid rgba(255,255,255,0.06);
        display: flex;
        gap: 6px;
      }
      .mc-notes-input {
        flex: 1;
        background: rgba(30, 41, 59, 0.8);
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 6px;
        padding: 5px 8px;
        font-size: 11px;
        color: #fff;
        outline: none;
      }
      .mc-notes-list {
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 320px;
        overflow-y: auto;
      }
      .mc-note-item {
        background: rgba(30, 41, 59, 0.6);
        border: 1px solid rgba(255,255,255,0.06);
        border-radius: 8px;
        padding: 7px 10px;
        font-size: 12px;
      }
      .mc-note-tag {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        margin-bottom: 3px;
        display: flex;
        justify-content: space-between;
        color: #94a3b8;
      }
      .mc-note-tag.concept { color: #38bdf8; }
      .mc-note-tag.action { color: #f59e0b; }
      .mc-note-tag.decision { color: #22c55e; }

      /* Transcript Panel Styling */
      .mc-transcript-list {
        padding: 10px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 360px;
        overflow-y: auto;
      }
      .mc-transcript-item {
        font-size: 11.5px;
        line-height: 1.4;
        color: #cbd5e1;
        padding: 4px 6px;
        border-radius: 4px;
        background: rgba(30, 41, 59, 0.3);
      }
      .mc-transcript-time {
        color: #64748b;
        font-size: 10px;
        font-family: monospace;
        margin-right: 4px;
      }

      /* Footer status */
      .mc-footer {
        padding: 7px 14px;
        background: rgba(15, 23, 42, 0.85);
        border-top: 1px solid rgba(255,255,255,0.06);
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: #64748b;
      }

      /* Collapsed Pill */
      .mc-pill {
        display: none;
        pointer-events: auto;
        cursor: pointer;
        background: rgba(15, 23, 42, 0.95);
        border: 1px solid rgba(255,255,255,0.2);
        padding: 8px 14px;
        border-radius: 99px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        align-items: center;
        gap: 8px;
        font-weight: 600;
        font-size: 12px;
        transition: transform 0.15s ease;
      }
      .mc-pill:hover { transform: scale(1.04); }
      .mc-pill.has-alert {
        border-color: #f59e0b;
        animation: mc-pill-glow 1.5s infinite;
      }
      @keyframes mc-pill-glow { 0%, 100% { box-shadow: 0 0 10px rgba(245, 158, 11, 0.4); } 50% { box-shadow: 0 0 20px rgba(245, 158, 11, 0.8); } }
    </style>

    <!-- Collapsed Pill View -->
    <div id="mc-pill-view" class="mc-pill">
      <span class="mc-pulse-dot" id="mc-pill-dot"></span>
      <span id="mc-pill-text">🎯 Meeting Copilot</span>
    </div>

    <!-- Main Expanded HUD -->
    <div id="mc-main-hud" class="mc-hud">
      <div class="mc-header" id="mc-drag-handle">
        <span class="mc-pulse-dot" id="mc-status-dot"></span>
        <span class="mc-title">🎯 Hush Copilot</span>
        <div class="mc-actions">
          <button class="mc-btn-export-hdr" id="mc-btn-export" title="Download Notes & Transcript">📥 Export</button>
          <button class="mc-btn-icon" id="mc-toggle-sound" title="Toggle audio alert">🔔</button>
          <button class="mc-btn-icon" id="mc-btn-min" title="Minimize to pill">─</button>
        </div>
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
              Set your goal above. When the speaker touches your topic, you'll receive instant wake-up alerts and doubt suggestions.
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 2: NOTES -->
      <div class="mc-tab-panel" id="mc-panel-notes">
        <div class="mc-notes-bar">
          <input type="text" id="mc-manual-note-input" class="mc-notes-input" placeholder="Add your own quick note..." />
          <button id="mc-btn-add-note" class="mc-btn-primary" style="padding:4px 10px;font-size:11px;">Add</button>
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
  const pillView = document.getElementById("mc-pill-view");
  const btnMin = document.getElementById("mc-btn-min");
  const toggleSound = document.getElementById("mc-toggle-sound");
  const goalInput = document.getElementById("mc-goal-input");
  const btnSaveGoal = document.getElementById("mc-btn-save-goal");
  const btnExport = document.getElementById("mc-btn-export");
  const dragHandle = document.getElementById("mc-drag-handle");

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

  // Load existing goal & settings from storage
  chrome.storage.local.get(["meeting_goal", "sound_enabled"], (data) => {
    if (data.meeting_goal) {
      currentGoal = data.meeting_goal;
      goalInput.value = currentGoal;
      updatePillText();
    }
    if (data.sound_enabled !== undefined) {
      soundEnabled = data.sound_enabled;
      toggleSound.textContent = soundEnabled ? "🔔" : "🔕";
    }
  });

  // Minimize / Expand toggles
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

  // Draggable HUD
  let isDragging = false;
  let startX, startY, origX, origY;

  dragHandle.addEventListener("mousedown", (e) => {
    if (e.target.closest("button")) return;
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

function saveGoal(goal) {
  currentGoal = goal;
  const statusEl = document.getElementById("mc-goal-status");
  if (statusEl) statusEl.textContent = goal ? "Aim Locked" : "No Aim";
  chrome.runtime.sendMessage({ type: "HUSH_SET_GOAL", goal });
  updatePillText();

  // Reset feed
  renderActiveCard({
    nudge_type: "STAY_SILENT",
    wake_up_summary: goal ? `Aim locked: "${goal}". Listening to Google Meet captions...` : "Monitoring live speech.",
  });
}

function updatePillText() {
  const pillText = document.getElementById("mc-pill-text");
  if (pillText) {
    pillText.textContent = currentGoal ? `🎯 Aim: ${currentGoal.slice(0, 24)}...` : "🎯 Meeting Copilot";
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
        <div style="color:#f1f5f9;line-height:1.4;">${n.text}</div>
        ${n.speaker ? `<div style="font-size:10px;color:#94a3b8;margin-top:4px;">— ${n.speaker}</div>` : ''}
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

  container.innerHTML = sessionTranscript.slice(-40).map(t => `
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
  if (!feed) return;

  activeWingmanRecord = record;
  const nudge = record.nudge_type || "STAY_SILENT";
  const speaker = record.speaker || "Speaker";
  const summary = record.wake_up_summary || "";
  const doubt = record.suggested_doubt || "";
  const doubtTip = record.doubt_tip || "💡 Asking now clarifies concepts and keeps you 100% on track!";
  const questions = record.suggested_questions || [];
  const reason = record.reason || "";

  let cardHtml = "";

  if (nudge === "FOCUS_ALERT") {
    playChime();
    if (dot) dot.className = "mc-pulse-dot alerting";
    if (pillDot) pillDot.className = "mc-pulse-dot alerting";
    if (pillView) pillView.classList.add("has-alert");

    cardHtml = `
      <div class="mc-card focus-alert">
        <div class="mc-card-header mc-badge-focus">
          <span>⚡ CONTEXT ALERT (Wake Up!)</span>
        </div>
        <div class="mc-card-summary">
          <strong>${speaker}</strong> is discussing your topic:
          <div style="margin-top:4px;">${summary}</div>
        </div>
        ${reason ? `<div style="font-size:11px;color:#cbd5e1;margin-bottom:6px;">💡 ${reason}</div>` : ""}
      </div>
    `;
  } else if (nudge === "ASK_DOUBT") {
    playChime();
    if (dot) dot.className = "mc-pulse-dot alerting";
    if (pillDot) pillDot.className = "mc-pulse-dot alerting";
    if (pillView) pillView.classList.add("has-alert");

    cardHtml = `
      <div class="mc-card ask-doubt">
        <div class="mc-card-header mc-badge-doubt">
          <span>🎤 ASK YOUR QUESTION NOW</span>
        </div>
        <div class="mc-card-summary">
          <strong>${speaker}</strong> just paused or opened the floor.
        </div>
        <div class="mc-doubt-tip">${doubtTip}</div>
        <div class="mc-doubt-quote" id="mc-doubt-text">"${doubt || `Could you clarify how this connects to ${currentGoal}?`}"</div>
        <div class="mc-btn-row">
          <button class="mc-btn-sm primary" id="mc-btn-copy-doubt">📋 Copy Question</button>
          <button class="mc-btn-sm" id="mc-btn-paste-chat">💬 Paste to Meet Chat</button>
          <button class="mc-btn-sm" id="mc-btn-mark-asked">✅ Mark Asked</button>
        </div>
        ${questions.length > 0 ? `
          <div style="margin-top:8px;font-size:11px;color:#94a3b8;">Alternative questions:</div>
          <div style="display:flex;flex-direction:column;gap:4px;margin-top:4px;">
            ${questions.map(q => `
              <div class="mc-btn-sm mc-alt-q" style="font-size:11px;cursor:pointer;" title="Click to use this question">${q}</div>
            `).join("")}
          </div>
        ` : ''}
      </div>
    `;
  } else if (nudge === "GOAL_RESOLVED") {
    playChime();
    cardHtml = `
      <div class="mc-card goal-resolved">
        <div class="mc-card-header mc-badge-resolved">
          <span>🎉 GOAL ADDRESSED</span>
        </div>
        <div class="mc-card-summary">
          ${summary || "Your meeting goal appears to have been answered in this discussion."}
        </div>
      </div>
    `;
  } else {
    // Routine talk
    if (dot) dot.className = "mc-pulse-dot";
    if (pillDot) pillDot.className = "mc-pulse-dot";

    cardHtml = `
      <div class="mc-card">
        <div class="mc-card-header">
          <span>👂 Monitoring Meeting</span>
        </div>
        <div class="mc-card-summary" style="color:#94a3b8;">
          ${summary || (currentGoal ? `Listening for: "${currentGoal}". Conversation is currently routine.` : "Monitoring live speech.")}
        </div>
      </div>
    `;
  }

  feed.innerHTML = cardHtml;

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

// ── Google Meet Captions Observation ──────────────────────────────────
function startObserving() {
  if (observer) return;

  const container = findCaptionContainer();
  const ccStatusEl = document.getElementById("mc-cc-status");

  if (!container) {
    if (ccStatusEl) ccStatusEl.innerHTML = '<span style="color:#f59e0b;">Turn on CC (Captions)</span>';
    const bodyObs = new MutationObserver(() => {
      if (findCaptionContainer()) {
        bodyObs.disconnect();
        startObserving();
      }
    });
    bodyObs.observe(document.body, { childList: true, subtree: true });
    sendStatus("waiting");
    return;
  }

  if (ccStatusEl) ccStatusEl.innerHTML = '<span style="color:#22c55e;">CC Connected</span>';
  sendStatus("connected");

  observer = new MutationObserver((mutations) => {
    if (!capturing) return;
    mutations.forEach(processMutation);
  });

  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
    characterDataOldValue: true,
  });
}

function stopObserving() {
  if (observer) { observer.disconnect(); observer = null; }
  flushBuffer(true);
  sendStatus("idle");
}

function processMutation(mutation) {
  const node = mutation.target.nodeType === Node.TEXT_NODE
    ? mutation.target.parentElement
    : mutation.target;
  if (!node) return;

  const block = findUtteranceBlock(node);
  if (!block) return;

  extractAndBuffer(block);
}

function findUtteranceBlock(el) {
  let cur = el;
  for (let i = 0; i < 8 && cur; i++) {
    if (cur.hasAttribute && (
      cur.getAttribute('jsname') === 'YSg9Nc' ||
      cur.getAttribute('data-utterance') !== null ||
      (cur.children.length >= 1 && cur.textContent.trim().length > 0)
    )) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return el;
}

function extractAndBuffer(block) {
  const speaker = extractSpeaker(block);
  const text    = extractText(block, speaker);
  if (!text) return;

  const prev = lastText.get(block) || "";
  const prevSpeaker = lastSpeaker.get(block) || "";

  lastText.set(block, text);
  lastSpeaker.set(block, speaker);

  if (prev && prev !== text && text.length - prev.length > 25) {
    commitLine(prevSpeaker || speaker, prev);
  }
}

function extractSpeaker(block) {
  for (const sel of SPEAKER_SELECTORS) {
    const el = block.querySelector(sel);
    if (el && el.textContent.trim()) return el.textContent.trim();
  }
  const firstSpan = block.querySelector("span");
  if (firstSpan) {
    const t = firstSpan.textContent.trim();
    if (t.length < 40 && !/[.,!?]/.test(t)) return t;
  }
  return "";
}

function extractText(block, speaker) {
  let raw = block.textContent.trim();
  if (speaker && raw.startsWith(speaker)) {
    raw = raw.slice(speaker.length).trim();
  }
  return raw;
}

function commitLine(speaker, text) {
  const clean = text.trim();
  if (!clean || clean === lastSentText) return;
  lastSentText = clean;

  const line = speaker ? `[${speaker}]: ${clean}` : clean;
  lineBuffer.push(line);

  // Add to in-memory live transcript
  sessionTranscript.push({
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    text: line,
  });
  renderTranscriptList();

  if (lineBuffer.length >= MAX_BUFFER_LINES) {
    flushBuffer(false);
  } else {
    scheduleFlush();
  }
}

function scheduleFlush() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => flushBuffer(false), FLUSH_DELAY_MS);
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
    renderActiveCard(msg.record);
    if (msg.sessionNotes && Array.isArray(msg.sessionNotes)) {
      sessionNotes = msg.sessionNotes;
      renderNotesList();
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
