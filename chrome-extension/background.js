/**
 * Hush background service worker (Manifest V3)
 *
 * Responsibilities
 * ----------------
 * 1. Receive HUSH_SEGMENT messages from the content script.
 * 2. POST them to the Hush backend (/api/analyse or /api/wingman).
 * 3. Forward the response back to the in-meeting HUD and popup.
 * 4. Maintain session state: decision history, auto-extracted notes, and transcript.
 */

"use strict";

const DEFAULT_BACKEND = "https://hush-meeting-copilot.onrender.com";
const FALLBACK_BACKEND = "http://localhost:8501";
const SESSION_ID = "gmeet-" + Date.now();
const MAX_HISTORY = 60;

// Ring buffer of decision and wingman records for popup display.
const decisionHistory = [];
const sessionNotes = [];
const sessionTranscript = [];

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
    sendResponse({
      history: decisionHistory,
      notes: sessionNotes,
      transcript: sessionTranscript,
    });
    return true;
  }

  if (msg.type === "HUSH_SAVE_NOTE") {
    if (msg.note) {
      sessionNotes.push(msg.note);
      chrome.storage.local.set({ hush_session_notes: sessionNotes });
    }
    sendResponse({ ok: true, notes: sessionNotes });
    return true;
  }

  if (msg.type === "HUSH_SET_BACKEND") {
    chrome.storage.local.set({ hush_backend_url: msg.url });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === "HUSH_CONTENT_READY") {
    // Content script loaded — notify it with stored data
    getGoal().then(goal => {
      if (sender && sender.tab && sender.tab.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          type: "WINGMAN_GOAL_UPDATED",
          goal,
          notes: sessionNotes,
          transcript: sessionTranscript,
        }).catch(() => {});
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

  // Record into session transcript
  const cleanLines = segment.split("\n").filter(l => l.trim().length > 0);
  for (const line of cleanLines) {
    sessionTranscript.push({
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      text: line,
    });
  }

  // Resilient multi-target dispatch (Render Cloud -> Localhost fallback)
  let result = null;
  const targetUrls = [DEFAULT_BACKEND, FALLBACK_BACKEND];
  let lastErr = null;

  for (const url of targetUrls) {
    try {
      const res = await fetch(`${url}/api/wingman`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segment, goal, session_id: SESSION_ID }),
      });
      if (res.ok) {
        result = await res.json();
        break;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  if (!result) {
    const errorMsg = lastErr ? lastErr.message : "Server waking up";
    broadcastToMeetTabs({
      type: "WINGMAN_STATUS",
      message: `Connecting to AI server... (${errorMsg})`
    });
    return;
  }

  if (!result) return;

  // Collect any extracted notes into session notes
  if (result.extracted_notes && Array.isArray(result.extracted_notes)) {
    for (const n of result.extracted_notes) {
      const isDuplicate = sessionNotes.some(existing => existing.text === n.text);
      if (!isDuplicate) {
        sessionNotes.push({
          ...n,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        });
      }
    }
  }

  const record = {
    ts: ts || Date.now(),
    segment,
    goal,
    wingman: result,
    nudge_type: result.nudge_type || "STAY_SILENT",
    wake_up_summary: result.wake_up_summary || "",
    suggested_doubt: result.suggested_doubt || "",
    doubt_tip: result.doubt_tip || "",
    suggested_questions: result.suggested_questions || [],
    extracted_notes: result.extracted_notes || [],
    speaker: result.speaker || "",
    reason: result.reason || "",
    goal_status: result.goal_status || "pending",
    decisions: result.decisions || [],
  };

  decisionHistory.push(record);
  if (decisionHistory.length > MAX_HISTORY) decisionHistory.shift();

  // Send wingman alert, notes and transcript directly to in-meeting HUD on Google Meet
  broadcastToMeetTabs({
    type: "WINGMAN_NUDGE",
    record,
    sessionNotes,
    latestLines: cleanLines,
  });

  // Also broadcast to popup
  broadcastToPopup({
    type: "WINGMAN_NUDGE",
    record,
    sessionNotes,
    latestLines: cleanLines,
  });
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
