/**
 * Hush Meeting Copilot - Background Service Worker
 * Manages extension state and communication between content script and popup
 */

// Extension state
let state = {
  isCapturing: false,
  sessionId: null,
  captionCount: 0,
  lastResponse: null,
  error: null
};

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Hush Background] Received message:', message);
  
  switch (message.action) {
    case 'captureStarted':
      state.isCapturing = true;
      state.sessionId = message.sessionId;
      state.error = null;
      updateBadge('ON');
      broadcastState();
      break;
      
    case 'captureStopped':
      state.isCapturing = false;
      updateBadge('OFF');
      broadcastState();
      break;
      
    case 'newCaption':
      state.captionCount++;
      broadcastState();
      break;
      
    case 'backendResponse':
      state.lastResponse = message.data;
      state.error = null;
      broadcastState();
      break;
      
    case 'error':
      state.error = message.error;
      updateBadge('ERR');
      broadcastState();
      break;
      
    case 'getState':
      sendResponse(state);
      break;
      
    case 'clearError':
      state.error = null;
      if (state.isCapturing) {
        updateBadge('ON');
      } else {
        updateBadge('OFF');
      }
      broadcastState();
      break;
  }
  
  return true;
});

/**
 * Update extension badge
 */
function updateBadge(text) {
  chrome.action.setBadgeText({ text });
  
  if (text === 'ON') {
    chrome.action.setBadgeBackgroundColor({ color: '#34D399' });  // Green
  } else if (text === 'ERR') {
    chrome.action.setBadgeBackgroundColor({ color: '#F87171' });  // Red
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#8D9AB5' });  // Gray
  }
}

/**
 * Broadcast state to all popup instances
 */
function broadcastState() {
  chrome.runtime.sendMessage({
    action: 'stateUpdate',
    state
  }).catch(() => {
    // Ignore if no listeners (popup closed)
  });
}

// Initialize badge
updateBadge('OFF');

console.log('[Hush Background] Service worker initialized');
