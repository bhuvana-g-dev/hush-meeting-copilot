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

// ── local heuristic wingman decider (instant fallback & offline resilience) ─
function evaluateWingmanLocally(segment, userGoal) {
  const normSeg = (segment || "").toLowerCase();
  const effectiveGoal = (userGoal && userGoal.trim()) ? userGoal : "Track deadline, project deliverables and actions";
  const normGoal = effectiveGoal.toLowerCase();

  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to", "for", "of", "with",
    "by", "from", "and", "or", "but", "so", "as", "if", "when", "how", "what", "which", "who",
    "whom", "this", "that", "these", "those", "my", "your", "our", "their", "his", "her", "its",
    "i", "you", "we", "they", "it", "me", "us", "them", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "can", "could", "should", "would", "will", "shall", "may", "might", "must"
  ]);

  const goalWords = normGoal
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  const priorityTriggers = [
    "deadline", "submission", "submit", "due date", "due by", "tomorrow", "tonight", "end of day",
    "hackathon", "project", "presentation", "demo", "review", "deliverable", "milestone",
    "blocker", "critical", "important", "urgent", "must do", "action item", "todo",
    "full stack", "react", "frontend", "backend", "api", "database", "deploy", "merge", "pr"
  ];

  const doubtTriggers = [
    "?", "any question", "any questions", "any doubt", "any doubts", "what do you think",
    "does anyone", "who wants to", "anyone have", "any thoughts", "feedback", "make sense",
    "is that clear", "shall we", "do you agree", "any concerns"
  ];

  const resolutionTriggers = [
    "approved", "agreed", "resolved", "completed", "done", "all set", "finalized"
  ];

  const matchedGoalWord = goalWords.find(w => normSeg.includes(w));
  const matchedTrigger = priorityTriggers.find(t => normSeg.includes(t));
  const isDoubt = doubtTriggers.some(d => normSeg.includes(d));
  const isResolved = resolutionTriggers.some(r => normSeg.includes(r));

  // Extract clean text without speaker tag
  const cleanText = segment.replace(/^\[[^\]]+\]:\s*/, "").trim();
  const speakerMatch = segment.match(/^\[([^\]]+)\]/);
  const speaker = speakerMatch ? speakerMatch[1] : "The speaker";

  const extracted_notes = [];
  const actionIndicators = [
    "deadline", "submit", "submission", "tomorrow", "today", "must", "need to",
    "will deliver", "assigned", "action item", "presentation", "demo", "finish", "complete"
  ];

  if (actionIndicators.some(ai => normSeg.includes(ai))) {
    extracted_notes.push({
      category: "Action Item",
      icon: "action",
      text: cleanText,
      speaker: speaker,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  } else if (isResolved) {
    extracted_notes.push({
      category: "Decision",
      icon: "decision",
      text: cleanText,
      speaker: speaker,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  }

  // 1. Question / Opportunity to Ask
  if (isDoubt) {
    const topic = matchedGoalWord || matchedTrigger || "the project timeline and criteria";
    return {
      nudge_type: "ASK_DOUBT",
      goal_relevance: matchedGoalWord ? "HIGH" : "MEDIUM",
      speaker: speaker,
      wake_up_summary: `Discussion window open: "${cleanText}"`,
      suggested_doubt: `Could you clarify the submission timeline and deliverables regarding ${topic}?`,
      doubt_tip: "Speaker invited questions or paused. Unmute now to clarify your questions!",
      suggested_questions: [
        `Could you elaborate on the deadline and submission criteria?`,
        `What are the immediate blockers or deliverables we should address?`,
        `Is there any specific documentation needed for this demo?`
      ],
      reason: "Open Discussion Window: Questions or feedback invited.",
      goal_status: "in_progress",
      extracted_notes: extracted_notes,
      decisions: [{ pattern: "#local-decider", cue: "ASK_DOUBT", conf: 0.96 }]
    };
  }

  // 2. High relevance / Context alert
  if (matchedGoalWord || matchedTrigger) {
    const topic = matchedGoalWord || matchedTrigger;
    return {
      nudge_type: "FOCUS_ALERT",
      goal_relevance: "HIGH",
      speaker: speaker,
      wake_up_summary: `The speaker just mentioned key topic "${topic}": "${cleanText}"`,
      reason: `Context Alert: '${topic}' matches your active meeting goal or key priorities!`,
      goal_status: "in_progress",
      extracted_notes: extracted_notes,
      decisions: [{ pattern: "#local-decider", cue: "FOCUS_ALERT", conf: 0.94 }]
    };
  }

  // 3. Goal resolved
  if (isResolved && (matchedGoalWord || matchedTrigger)) {
    return {
      nudge_type: "GOAL_RESOLVED",
      goal_relevance: "HIGH",
      speaker: speaker,
      wake_up_summary: `Goal item addressed: "${cleanText}"`,
      reason: "Discussion indicates key milestone has been finalized or agreed upon.",
      goal_status: "resolved",
      extracted_notes: extracted_notes,
      decisions: [{ pattern: "#local-decider", cue: "GOAL_RESOLVED", conf: 0.90 }]
    };
  }

  // 4. Default: Stay silent
  return {
    nudge_type: "STAY_SILENT",
    goal_relevance: "LOW",
    speaker: speaker,
    wake_up_summary: "",
    reason: "General discussion in progress.",
    goal_status: "in_progress",
    extracted_notes: extracted_notes,
    decisions: [{ pattern: "#local-decider", cue: "STAY_SILENT", conf: 0.8 }]
  };
}

// ── core: POST segment to backend (with instant local decider fallback) ─
async function handleSegment(segment, ts, explicitGoal) {
  if (!segment || !segment.trim()) return;

  const goal = explicitGoal !== undefined ? explicitGoal : await getGoal();

  // Record into session transcript
  const cleanLines = segment.split("\n").filter(l => l.trim().length > 0);
  for (const line of cleanLines) {
    sessionTranscript.push({
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      text: line,
    });
  }

  // Resilient multi-target dispatch (Localhost ultra-fast -> Render Cloud -> Local Decider)
  let result = null;
  const targetUrls = [FALLBACK_BACKEND, DEFAULT_BACKEND];

  for (const url of targetUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);

      const res = await fetch(`${url}/api/wingman`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segment, goal, session_id: SESSION_ID }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        result = await res.json();
        break;
      }
    } catch (e) {
      // Continue to next or fallback
    }
  }

  // Bulletproof fallback: If backend timed out or server is offline, use instant in-extension heuristic
  if (!result) {
    result = evaluateWingmanLocally(segment, goal);
  }

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
