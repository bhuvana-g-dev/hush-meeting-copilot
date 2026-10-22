/**
 * Hush Meeting Copilot - Google Meet Content Script
 * Captures visible captions from Google Meet and sends them to the Hush backend.
 * Only captures after user clicks "Start Capture" in the extension popup.
 */

// Configuration
const CONFIG = {
  captionCheckInterval: 500,  // Check for new captions every 500ms
  batchInterval: 3000,        // Send batched captions every 3 seconds
  maxRetries: 3,
  retryDelay: 2000
};

// State
let isCapturing = false;
let captionBuffer = [];
let lastCaptionText = '';
let captionObserver = null;
let batchTimer = null;
let backendUrl = 'http://localhost:8501';  // Default, will be updated from storage
let sessionId = null;

/**
 * Initialize the content script
 */
function init() {
  console.log('[Hush] Content script initialized on Google Meet');
  
  // Load settings from storage
  chrome.storage.local.get(['backendUrl', 'sessionId', 'isCapturing'], (result) => {
    if (result.backendUrl) {
      backendUrl = result.backendUrl;
    }
    if (result.sessionId) {
      sessionId = result.sessionId;
    } else {
      // Generate new session ID
      sessionId = `meet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      chrome.storage.local.set({ sessionId });
    }
    
    // Restore capturing state if it was active
    if (result.isCapturing) {
      startCapture();
    }
  });
  
  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Hush] Received message:', message);
    
    if (message.action === 'startCapture') {
      startCapture();
      sendResponse({ success: true });
    } else if (message.action === 'stopCapture') {
      stopCapture();
      sendResponse({ success: true });
    } else if (message.action === 'getStatus') {
      sendResponse({ 
        isCapturing, 
        capturedCount: captionBuffer.length,
        sessionId 
      });
    } else if (message.action === 'updateBackendUrl') {
      backendUrl = message.url;
      chrome.storage.local.set({ backendUrl });
      sendResponse({ success: true });
    }
    
    return true;  // Keep message channel open for async response
  });
}

/**
 * Start capturing captions from Google Meet
 */
function startCapture() {
  if (isCapturing) {
    console.log('[Hush] Already capturing');
    return;
  }
  
  console.log('[Hush] Starting caption capture');
  isCapturing = true;
  chrome.storage.local.set({ isCapturing: true });
  
  // Notify background script
  chrome.runtime.sendMessage({ 
    action: 'captureStarted',
    sessionId 
  });
  
  // Start observing captions
  observeCaptions();
  
  // Start batch processing timer
  batchTimer = setInterval(processCaptionBatch, CONFIG.batchInterval);
}

/**
 * Stop capturing captions
 */
function stopCapture() {
  if (!isCapturing) {
    return;
  }
  
  console.log('[Hush] Stopping caption capture');
  isCapturing = false;
  chrome.storage.local.set({ isCapturing: false });
  
  // Send any remaining captions
  if (captionBuffer.length > 0) {
    processCaptionBatch();
  }
  
  // Clear timers and observers
  if (batchTimer) {
    clearInterval(batchTimer);
    batchTimer = null;
  }
  
  if (captionObserver) {
    captionObserver.disconnect();
    captionObserver = null;
  }
  
  // Notify background script
  chrome.runtime.sendMessage({ action: 'captureStopped' });
}

/**
 * Observe Google Meet caption elements for changes
 */
function observeCaptions() {
  // Google Meet caption selectors (may need updates if Google changes their DOM)
  const captionSelectors = [
    '[jsname="YSxPC"]',  // Main caption container
    '.a4cQT',            // Caption text elements
    '[jscontroller="qXszGb"]'  // Alternative caption container
  ];
  
  // Try to find caption container
  const findCaptionContainer = () => {
    for (const selector of captionSelectors) {
      const container = document.querySelector(selector);
      if (container) {
        return container;
      }
    }
    return null;
  };
  
  // Wait for captions to appear and start observing
  const checkForCaptions = setInterval(() => {
    const captionContainer = findCaptionContainer();
    
    if (captionContainer) {
      console.log('[Hush] Found caption container:', captionContainer);
      clearInterval(checkForCaptions);
      
      // Create MutationObserver to watch for caption changes
      captionObserver = new MutationObserver((mutations) => {
        if (!isCapturing) return;
        
        const captionText = extractCaptionText(captionContainer);
        if (captionText && captionText !== lastCaptionText) {
          console.log('[Hush] New caption:', captionText);
          lastCaptionText = captionText;
          captionBuffer.push({
            text: captionText,
            timestamp: new Date().toISOString()
          });
          
          // Notify popup of new caption
          chrome.runtime.sendMessage({ 
            action: 'newCaption',
            caption: captionText 
          });
        }
      });
      
      // Start observing
      captionObserver.observe(captionContainer, {
        childList: true,
        subtree: true,
        characterData: true
      });
      
      console.log('[Hush] Caption observer started');
    }
  }, CONFIG.captionCheckInterval);
  
  // Stop checking after 30 seconds if captions not found
  setTimeout(() => {
    clearInterval(checkForCaptions);
    if (!captionObserver) {
      console.warn('[Hush] Captions not found after 30 seconds. Make sure captions are enabled in Google Meet.');
      chrome.runtime.sendMessage({ 
        action: 'error',
        error: 'Captions not found. Please enable captions in Google Meet (Settings > Captions).' 
      });
    }
  }, 30000);
}

/**
 * Extract caption text from the caption container
 */
function extractCaptionText(container) {
  if (!container) return '';
  
  // Try different methods to extract text
  const textElements = container.querySelectorAll('.a4cQT, [jsname="tgaKEf"]');
  if (textElements.length > 0) {
    const texts = Array.from(textElements).map(el => el.textContent.trim());
    return texts.filter(t => t).join(' ');
  }
  
  // Fallback to container text
  return container.textContent.trim();
}

/**
 * Process and send batched captions to backend
 */
async function processCaptionBatch() {
  if (captionBuffer.length === 0) return;
  
  // Get captions to send
  const captions = [...captionBuffer];
  captionBuffer = [];
  
  // Format as transcript
  const transcript = captions.map(c => c.text).join('\n');
  
  console.log('[Hush] Sending batch:', { count: captions.length, transcript });
  
  try {
    await sendToBackend(transcript);
  } catch (error) {
    console.error('[Hush] Failed to send captions:', error);
    // Put captions back in buffer for retry
    captionBuffer = captions.concat(captionBuffer);
  }
}

/**
 * Send transcript to Hush backend with retry logic
 */
async function sendToBackend(transcript, retryCount = 0) {
  const apiUrl = `${backendUrl}/api/chat`;
  
  try {
    console.log('[Hush] Sending to backend:', apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: transcript,
        session_id: sessionId,
        images: []
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error);
    }
    
    console.log('[Hush] Backend response:', data);
    
    // Send response to background script for popup display
    chrome.runtime.sendMessage({
      action: 'backendResponse',
      data: {
        reply: data.reply,
        decisions: data.decisions || [],
        latency_ms: data.latency_ms,
        model_id: data.model_id
      }
    });
    
    return data;
    
  } catch (error) {
    console.error('[Hush] Backend request failed:', error);
    
    // Retry logic
    if (retryCount < CONFIG.maxRetries) {
      console.log(`[Hush] Retrying... (${retryCount + 1}/${CONFIG.maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
      return sendToBackend(transcript, retryCount + 1);
    }
    
    // Send error to popup
    chrome.runtime.sendMessage({
      action: 'error',
      error: `Failed to connect to backend: ${error.message}`
    });
    
    throw error;
  }
}

/**
 * Check if we're on a Google Meet call page
 */
function isOnMeetCall() {
  return window.location.pathname.match(/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Handle page navigation within Meet
let lastUrl = location.href;
new MutationObserver(() => {
  const currentUrl = location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    if (isOnMeetCall()) {
      console.log('[Hush] Navigated to Meet call');
      // Reset caption observer
      if (isCapturing) {
        stopCapture();
        setTimeout(startCapture, 1000);
      }
    }
  }
}).observe(document, { subtree: true, childList: true });
