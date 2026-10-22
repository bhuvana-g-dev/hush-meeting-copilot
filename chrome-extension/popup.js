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

// Initialize state
chrome.storage.local.get(["meeting_goal", "hush_backend_url"], (data) => {
  if (data.meeting_goal) {
    goalInput.value = data.meeting_goal;
    goalStatus.textContent = "Aim Locked";
  }
  backendInput.value = data.hush_backend_url || "http://localhost:8501";
});

// Load recent history from background
chrome.runtime.sendMessage({ type: "HUSH_GET_HISTORY" }, (res) => {
  if (res && res.history && res.history.length > 0) {
    feed.innerHTML = "";
    for (const rec of res.history.slice(-10).reverse()) {
      renderRecord(rec);
    }
  }
});

// Goal save handler
btnSaveGoal.addEventListener("click", () => {
  const goal = goalInput.value.trim();
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
  const url = backendInput.value.trim() || "http://localhost:8501";
  chrome.runtime.sendMessage({ type: "HUSH_SET_BACKEND", url }, () => {
    btnSaveUrl.textContent = "Saved";
    setTimeout(() => { btnSaveUrl.textContent = "Save URL"; }, 1500);
  });
});

// Message listener for real-time wingman updates
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "WINGMAN_NUDGE" && msg.record) {
    renderRecord(msg.record, true);
  }
  if (msg.type === "WINGMAN_GOAL_UPDATED") {
    goalInput.value = msg.goal || "";
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
    stDot.style.background = "#ef4444";
    stText.textContent = msg.message;
  }
});

function renderRecord(rec, prepend = false) {
  const nudge = rec.nudge_type || (rec.wingman && rec.wingman.nudge_type) || "STAY_SILENT";
  const speaker = rec.speaker || (rec.wingman && rec.wingman.speaker) || "Speaker";
  const summary = rec.wake_up_summary || (rec.wingman && rec.wingman.wake_up_summary) || "";
  const doubt = rec.suggested_doubt || (rec.wingman && rec.wingman.suggested_doubt) || "";
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
