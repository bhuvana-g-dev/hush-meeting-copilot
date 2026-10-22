/**
 * Hush background service worker (Manifest V3)
 *
 * Responsibilities
 * ----------------
 * 1. Receive HUSH_SEGMENT messages from the content script.
 * 2. POST them to the Hush backend (/api/analyse).
 * 3. Forward the response (decisions, notes, interjections) back to the
 *    popup (if open) so it can display them.
 * 4. Maintain a ring buffer of the last 50 decisions so the popup can
 *    display them even if it was closed during capture.
 *
 * Security
 * --------
 * - The backend URL is stored in chrome.storage.local, never hard-coded.
 * - No API keys are stored in the extension.  The Hush backend itself
 *   handles any authentication required.
 * - CORS: the backend must allow requests from the extension origin.
 *   The /api/analyse endpoint in server.py already returns permissive
 *   CORS headers for local use (FastAPI defaults).  If you add auth, add
 *   a HUSH_TOKEN storage key and include it as a Bearer token here.
 */

"use strict";

const DEFAULT_BACKEND = "http://localhost:8501";
const FALLBACK_BACKEND = "http://localhost:8503";
const SESSION_ID = "gmeet-" + Date.now();
const MAX_HISTORY = 50;

// Ring buffer of decision and wingman records for popup display.
const decisionHistory = [];

// ── storage helpers ───────────────────────────────────────────────────
async function getBackendUrl() {
  const data = await chrome.storage.local.get("hush_backend_url");
  return (data.hush_backend_url || DEFAULT_BACKEND).replace(/\/$/, "");
}

async function getGoal() {
  const data = await chrome.storage.local.get("meeting_goal");
  return data.meeting_goal || "";
}

// ── message routing ───────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "HUSH_SEGMENT") {
    handleSegment(msg.segment, msg.ts, msg.goal).catch(console.error);
    return false;
  }

  if (msg.type === "HUSH_SET_GOAL") {
    chrome.storage.local.set({ meeting_goal: msg.goal || "" }, () => {
      // Notify all Meet tabs about updated goal
      broadcastToMeetTabs({ type: "WINGMAN_GOAL_UPDATED", goal: msg.goal });
      broadcastToPopup({ type: "WINGMAN_GOAL_UPDATED", goal: msg.goal });
      // Also notify backend
      getBackendUrl().then(url => {
        fetch(url + "/api/goal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ goal: msg.goal || "" })
        }).catch(() => {});
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "HUSH_GET_GOAL") {
    getGoal().then(goal => sendResponse({ goal }));
    return true;
  }

  if (msg.type === "HUSH_GET_HISTORY") {
    sendResponse({ history: decisionHistory });
    return true;
  }

  if (msg.type === "HUSH_SET_BACKEND") {
    chrome.storage.local.set({ hush_backend_url: msg.url });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "HUSH_CONTENT_READY") {
    // Content script loaded — notify it with the stored goal if any
    getGoal().then(goal => {
      if (sender && sender.tab && sender.tab.id) {
        chrome.tabs.sendMessage(sender.tab.id, { type: "WINGMAN_GOAL_UPDATED", goal }).catch(() => {});
      }
    });
    return false;
  }

  if (msg.type === "HUSH_CONTENT_STATUS") {
    broadcastToPopup({ type: "HUSH_STATUS_UPDATE", status: msg.status });
    return false;
  }
});

// ── core: POST segment to backend ─────────────────────────────────────
async function handleSegment(segment, ts, explicitGoal) {
  if (!segment || !segment.trim()) return;

  const goal = explicitGoal !== undefined ? explicitGoal : await getGoal();
  let backendUrl = await getBackendUrl();

  // Try wingman endpoint first
  let result = null;
  let usedUrl = backendUrl;

  try {
    let res = await fetch(`${backendUrl}/api/wingman`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ segment, goal, session_id: SESSION_ID }),
    });

    // If 404 on port 8501, try fallback 8503
    if (!res.ok && res.status === 404 && backendUrl === DEFAULT_BACKEND) {
      const fallbackRes = await fetch(`${FALLBACK_BACKEND}/api/wingman`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segment, goal, session_id: SESSION_ID }),
      }).catch(() => null);
      if (fallbackRes && fallbackRes.ok) {
        res = fallbackRes;
        usedUrl = FALLBACK_BACKEND;
        chrome.storage.local.set({ hush_backend_url: FALLBACK_BACKEND });
      }
    }

    if (res.ok) {
      result = await res.json();
    } else {
      // Fallback to /api/analyse
      const analyseRes = await fetch(`${backendUrl}/api/analyse`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segment, goal, session_id: SESSION_ID }),
      });
      if (analyseRes.ok) {
        const analyseJson = await analyseRes.json();
        result = analyseJson.wingman || {
          nudge_type: "STAY_SILENT",
          goal_relevance: "NONE",
          wake_up_summary: "",
          suggested_doubt: "",
          reason: "",
          goal_status: "pending",
          decisions: analyseJson.decisions || []
        };
      }
    }
  } catch (err) {
    const errorMsg = `Cannot reach Wingman backend at ${backendUrl} — is kit demo running? (${err.message})`;
    broadcastToMeetTabs({ type: "WINGMAN_ERROR", message: errorMsg });
    broadcastToPopup({ type: "HUSH_ERROR", message: errorMsg });
    return;
  }

  if (!result) return;

  const record = {
    ts: ts || Date.now(),
    segment,
    goal,
    wingman: result,
    nudge_type: result.nudge_type || "STAY_SILENT",
    wake_up_summary: result.wake_up_summary || "",
    suggested_doubt: result.suggested_doubt || "",
    speaker: result.speaker || "",
    reason: result.reason || "",
    goal_status: result.goal_status || "pending",
    decisions: result.decisions || [],
  };

  decisionHistory.push(record);
  if (decisionHistory.length > MAX_HISTORY) decisionHistory.shift();

  // Send wingman alert directly to in-meeting HUD on Google Meet
  broadcastToMeetTabs({ type: "WINGMAN_NUDGE", record });

  // Also broadcast to popup
  broadcastToPopup({ type: "WINGMAN_NUDGE", record });
  broadcastToPopup({ type: "HUSH_RESULT", record });
}

// ── broadcast helpers ─────────────────────────────────────────────────
function broadcastToPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function broadcastToMeetTabs(msg) {
  chrome.tabs.query({ url: "https://meet.google.com/*" }, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
      }
    }
  });
}
