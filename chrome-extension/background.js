// Background service worker for Hush Chrome Extension
// Handles communication between content script, popup, and Hush backend

const HUSH_BACKEND_URL = 'http://localhost:8501';
let captureState = {
  isCapturing: false,
  isMeetingActive: false,
  lastError: null,
  backendConnected: false
};

console.log('[Hush Background] Service worker initialized');

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Hush Background] Received message:', message.type);

  if (message.type === 'TRANSCRIPT_SEGMENT') {
    handleTranscriptSegment(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async response
  }

  if (message.type === 'STATUS_UPDATE') {
    captureState.isCapturing = message.data.isCapturing;
    broadcastStateToPopup();
    sendResponse({ success: true });
  }

  if (message.type === 'MEETING_STATUS') {
    captureState.isMeetingActive = message.data.isActive;
    broadcastStateToPopup();
    sendResponse({ success: true });
  }

  if (message.type === 'GET_STATE') {
    sendResponse({ success: true, state: captureState });
  }

  if (message.type === 'CHECK_BACKEND') {
    checkBackendConnection()
      .then(connected => {
        captureState.backendConnected = connected;
        sendResponse({ success: true, connected });
      })
      .catch(() => {
        captureState.backendConnected = false;
        sendResponse({ success: true, connected: false });
      });
    return true; // Async response
  }

  if (message.type === 'START_CAPTURE_FROM_POPUP') {
    sendMessageToContentScript({ type: 'START_CAPTURE' })
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.type === 'STOP_CAPTURE_FROM_POPUP') {
    sendMessageToContentScript({ type: 'STOP_CAPTURE' })
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return false;
});

async function handleTranscriptSegment(data) {
  console.log('[Hush Background] Processing transcript segment:', data.segment);

  try {
    // Get session ID from storage or create new one
    const sessionData = await chrome.storage.local.get(['sessionId']);
    const sessionId = sessionData.sessionId || `meet-${Date.now()}`;
    
    if (!sessionData.sessionId) {
      await chrome.storage.local.set({ sessionId });
    }

    // Send to Hush backend using existing /api/chat endpoint
    const response = await fetch(`${HUSH_BACKEND_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: data.segment,
        session_id: sessionId,
        images: []
      })
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error);
    }

    console.log('[Hush Background] Backend response:', result);
    captureState.lastError = null;
    captureState.backendConnected = true;

    // Broadcast result to popup and any listening tabs
    broadcastAnalysisResult(result);

    return result;

  } catch (error) {
    console.error('[Hush Background] Error sending to backend:', error);
    captureState.lastError = error.message;
    captureState.backendConnected = false;
    throw error;
  }
}

async function checkBackendConnection() {
  try {
    const response = await fetch(`${HUSH_BACKEND_URL}/api/info`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch (error) {
    console.warn('[Hush Background] Backend not reachable:', error.message);
    return false;
  }
}

async function sendMessageToContentScript(message) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tabs.length === 0) {
    throw new Error('No active tab found');
  }

  const tab = tabs[0];
  
  if (!tab.url || !tab.url.includes('meet.google.com')) {
    throw new Error('Not on a Google Meet page');
  }

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id, message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function broadcastStateToPopup() {
  // Popup will poll for state, but we can also push updates
  chrome.runtime.sendMessage({
    type: 'STATE_CHANGED',
    state: captureState
  }).catch(() => {
    // Popup might not be open, that's fine
  });
}

function broadcastAnalysisResult(result) {
  chrome.runtime.sendMessage({
    type: 'ANALYSIS_RESULT',
    data: result
  }).catch(() => {
    // No listeners, that's fine
  });

  // Also store latest result for popup to retrieve
  chrome.storage.local.set({ 
    latestAnalysis: result,
    latestAnalysisTime: Date.now()
  });
}

// Periodic backend health check
setInterval(async () => {
  const connected = await checkBackendConnection();
  if (captureState.backendConnected !== connected) {
    captureState.backendConnected = connected;
    broadcastStateToPopup();
  }
}, 10000); // Check every 10 seconds

// Initial backend check
checkBackendConnection().then(connected => {
  captureState.backendConnected = connected;
  console.log('[Hush Background] Initial backend status:', connected);
});
