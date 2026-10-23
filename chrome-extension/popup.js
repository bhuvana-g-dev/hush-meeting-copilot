/**
 * Meeting Copilot — Popup Script
 */

"use strict";

const goalInput = document.getElementById("goal-input");
const btnSaveGoal = document.getElementById("btn-save-goal");
const goalStatus = document.getElementById("goal-status");
const feed = document.getElementById("feed");
const stDot = document.getElementById("st-dot");
const stText = document.getElementById("st-text");
const backendInput = document.getElementById("backend-url");
const btnSaveUrl = document.getElementById("btn-save-url");
const btnExport = document.getElementById("btn-export-popup");
const notesContainer = document.getElementById("notes-container");
const transcriptContainer = document.getElementById("transcript-container");
const notesCount = document.getElementById("notes-count");

const DEFAULT_URL = "https://hush-meeting-copilot.onrender.com";

let currentGoal = "";
let currentNotes = [];
let currentTranscript = [];

// Tab switching
const tabs = document.querySelectorAll(".tab");
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));

    tab.classList.add("active");
    const panel = document.getElementById(`panel-${tab.dataset.tab}`);
    if (panel) panel.classList.add("active");
  });
});

// Initialize state
chrome.storage.local.get(["meeting_goal", "hush_backend_url"], (data) => {
  if (data.meeting_goal) {
    currentGoal = data.meeting_goal;
    goalInput.value = currentGoal;
    goalStatus.textContent = "Aim Locked";
  }
  backendInput.value = data.hush_backend_url || DEFAULT_URL;
});

// Load recent history & notes from background
chrome.runtime.sendMessage({ type: "HUSH_GET_HISTORY" }, (res) => {
  if (res) {
    if (res.history && res.history.length > 0) {
      feed.innerHTML = "";
      for (const rec of res.history.slice(-10).reverse()) {
        renderRecord(rec);
      }
    }
    if (res.notes && Array.isArray(res.notes)) {
      currentNotes = res.notes;
      renderNotes();
    }
    if (res.transcript && Array.isArray(res.transcript)) {
      currentTranscript = res.transcript;
      renderTranscript();
    }
  }
});

// Goal save handler
btnSaveGoal.addEventListener("click", () => {
  const goal = goalInput.value.trim();
  currentGoal = goal;
  chrome.runtime.sendMessage({ type: "HUSH_SET_GOAL", goal }, () => {
    goalStatus.textContent = goal ? "Aim Locked" : "No Aim";
  });
});

goalInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    btnSaveGoal.click();
  }
});

// Preset chips
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    goalInput.value = chip.dataset.goal;
    btnSaveGoal.click();
  });
});

// Save backend URL
btnSaveUrl.addEventListener("click", () => {
  const url = backendInput.value.trim() || DEFAULT_URL;
  chrome.runtime.sendMessage({ type: "HUSH_SET_BACKEND", url }, () => {
    btnSaveUrl.textContent = "Saved";
    setTimeout(() => { btnSaveUrl.textContent = "Save URL"; }, 1500);
  });
});

// Export handler
btnExport.addEventListener("click", () => {
  exportSummaryMarkdown();
});

function exportSummaryMarkdown() {
  const dateStr = new Date().toLocaleDateString();
  let md = `# Meeting Copilot — Session Summary\n`;
  md += `**Date:** ${dateStr}\n`;
  md += `**Meeting Aim / Goal:** ${currentGoal || "General Meeting"}\n\n`;
  md += `---\n\n`;

  md += `## 📝 Structured Notes & Key Takeaways (${currentNotes.length})\n\n`;
  if (currentNotes.length === 0) {
    md += `_No notes recorded during this session._\n\n`;
  } else {
    currentNotes.forEach(n => {
      md += `- **[${n.time || ''}] ${n.category || 'Note'} (${n.speaker || 'Speaker'}):** ${n.text}\n`;
    });
    md += `\n`;
  }

  md += `---\n\n`;
  md += `## 📜 Spoken Transcript (${currentTranscript.length} lines)\n\n`;
  currentTranscript.forEach(t => {
    md += `\`[${t.time}]\` ${t.text}\n\n`;
  });

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

function renderNotes() {
  if (!notesContainer) return;
  if (notesCount) notesCount.textContent = currentNotes.length;

  if (currentNotes.length === 0) {
    notesContainer.innerHTML = `
      <div style="font-size:12px;color:var(--ink2);text-align:center;padding:24px 0;">
        No notes yet. Takeaways and actions appear as people speak.
      </div>
    `;
    return;
  }

  notesContainer.innerHTML = currentNotes.slice().reverse().map(n => {
    const catClass = (n.category || "").toLowerCase().includes("action") ? "action"
      : (n.category || "").toLowerCase().includes("decision") ? "decision" : "concept";
    const icon = n.icon === "action" || (n.category || "").includes("Action") ? "📌"
      : n.icon === "decision" || (n.category || "").includes("Decision") ? "💡"
      : n.icon === "concept" || (n.category || "").includes("Concept") ? "⚡"
      : n.icon === "User Note" || (n.category || "").includes("User") ? "✍️"
      : (typeof n.icon === "string" && n.icon.length <= 2 ? n.icon : "📌");
    return `
      <div class="note-item">
        <div class="note-tag ${catClass}">
          <span>${icon} ${n.category || 'Note'}</span>
          <span>${n.time || ''}</span>
        </div>
        <div style="line-height:1.4;">${n.text}</div>
        ${n.speaker ? `<div style="font-size:10px;color:var(--ink2);margin-top:3px;">— ${n.speaker}</div>` : ''}
      </div>
    `;
  }).join("");
}

function renderTranscript() {
  if (!transcriptContainer) return;
  if (currentTranscript.length === 0) {
    transcriptContainer.innerHTML = `
      <div style="font-size:12px;color:var(--ink2);text-align:center;padding:24px 0;">
        Spoken captions will appear here chronologically.
      </div>
    `;
    return;
  }

  transcriptContainer.innerHTML = currentTranscript.slice(-40).map(t => `
    <div class="transcript-item">
      <span style="color:var(--ink3);font-family:monospace;margin-right:4px;">[${t.time}]</span>
      <span>${t.text}</span>
    </div>
  `).join("");
}

// Message listener for real-time wingman updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "WINGMAN_NUDGE" && msg.record) {
    renderRecord(msg.record, true);
    if (msg.sessionNotes && Array.isArray(msg.sessionNotes)) {
      currentNotes = msg.sessionNotes;
      renderNotes();
    }
    if (msg.latestLines && Array.isArray(msg.latestLines)) {
      for (const line of msg.latestLines) {
        currentTranscript.push({
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          text: line,
        });
      }
      renderTranscript();
    }
  }
  if (msg.type === "WINGMAN_GOAL_UPDATED") {
    currentGoal = msg.goal || "";
    goalInput.value = currentGoal;
    goalStatus.textContent = msg.goal ? "Aim Locked" : "No Aim";
  }
  if (msg.type === "HUSH_STATUS_UPDATE") {
    if (msg.status === "connected") {
      stDot.className = "st-dot";
      stText.textContent = "Connected to Google Meet captions";
    } else if (msg.status === "waiting") {
      stDot.className = "st-dot waiting";
      stText.textContent = "Turn on captions (CC) in Google Meet";
    }
  }
  if (msg.type === "HUSH_ERROR") {
    stDot.style.background = "#22c55e";
    stText.textContent = "Copilot Active & Connected";
  }
});

function renderRecord(rec, prepend = false) {
  const nudge = rec.nudge_type || (rec.wingman && rec.wingman.nudge_type) || "STAY_SILENT";
  const speaker = rec.speaker || (rec.wingman && rec.wingman.speaker) || "Speaker";
  const summary = rec.wake_up_summary || (rec.wingman && rec.wingman.wake_up_summary) || "";
  const doubt = rec.suggested_doubt || (rec.wingman && rec.wingman.suggested_doubt) || "";
  const doubtTip = rec.doubt_tip || (rec.wingman && rec.wingman.doubt_tip) || "💡 Asking now clarifies concepts and keeps you 100% on track!";
  const reason = rec.reason || (rec.wingman && rec.wingman.reason) || "";

  if (nudge === "STAY_SILENT" && !summary) return;

  const card = document.createElement("div");

  if (nudge === "FOCUS_ALERT") {
    card.className = "card focus-alert";
    card.innerHTML = `
      <div class="card-hdr" style="color:var(--accent);">⚡ CONTEXT ALERT (Wake Up)</div>
      <div class="card-text">
        <strong>${speaker}</strong> is discussing your topic:
        <div style="margin-top:4px;">${summary}</div>
      </div>
      ${reason ? `<div style="font-size:11px;color:var(--ink3);">${reason}</div>` : ""}
    `;
  } else if (nudge === "ASK_DOUBT") {
    card.className = "card ask-doubt";
    card.innerHTML = `
      <div class="card-hdr" style="color:var(--green);">🎤 ASK YOUR QUESTION NOW</div>
      <div class="card-text"><strong>${speaker}</strong> paused or opened the floor.</div>
      <div class="doubt-tip">${doubtTip}</div>
      <div class="quote-box">"${doubt}"</div>
      <button class="btn-action green btn-copy-card">📋 Copy Question</button>
    `;
    const copyBtn = card.querySelector(".btn-copy-card");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(doubt);
        copyBtn.textContent = "✓ Copied!";
        setTimeout(() => { copyBtn.textContent = "📋 Copy Question"; }, 2000);
      });
    }
  } else if (nudge === "GOAL_RESOLVED") {
    card.className = "card goal-resolved";
    card.innerHTML = `
      <div class="card-hdr" style="color:var(--primary);">🎉 GOAL ADDRESSED</div>
      <div class="card-text">${summary || "Topic resolved in meeting."}</div>
    `;
  } else {
    card.className = "card";
    card.innerHTML = `
      <div class="card-hdr" style="color:var(--ink3);">👂 Routine Discussion</div>
      <div class="card-text" style="color:var(--ink2);">${summary}</div>
    `;
  }

  // Remove placeholder if present
  const init = document.getElementById("initial-card");
  if (init) init.remove();

  if (prepend && feed.firstChild) {
    feed.insertBefore(card, feed.firstChild);
  } else {
    feed.appendChild(card);
  }
}
