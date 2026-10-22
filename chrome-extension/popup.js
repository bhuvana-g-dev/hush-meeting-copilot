/**
 * Hush Meeting Copilot - Popup Script
 * Controls the extension popup UI and communicates with content script
 */

// UI elements
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const openDashboardBtn = document.getElementById('openDashboardBtn');
const backendUrlInput = document.getElementById('backendUrl');
const statusDot = document.getElementById('statusDot');
const capturingStatus = document.getElementById('capturingStatus');
const captionCount = document.getElementById('captionCount');
const backendStatus = document.getElementById('backendStatus');
const sessionId = document.getElementById('sessionId');
const errorAlert = document.getElementById('errorAlert');
const errorMessage = document.getElementById('errorMessage');
const infoAlert = document.getElementById('infoAlert');
const infoMessage = document.getElementById('infoMessage');
const decisionPreview = document.getElementById('decisionPreview');

// State
let currentState = {
  isCapturing: false,
  captionCount: 0,
  sessionId: null,
  error: null,
  lastResponse: null
};

/**
 * Initialize popup
 */
async function init() {
  console.log('[Hush Popup] Initializing');
  
  // Load settings
  chrome.storage.local.get(['backendUrl'], (result) => {
    if (result.backendUrl) {
      backendUrlInput.value = result.backendUrl;
    }
  });
  
  // Get current state from background
  chrome.runtime.sendMessage({ action: 'getState' }, (state) => {
    if (state) {
      updateUI(state);
    }
  });
  
  // Check if we're on a Meet page
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && !tab.url?.includes('meet.google.com')) {
    showInfo('Open a Google Meet call to start capturing captions');
    startBtn.disabled = true;
  }
  
  // Set up event listeners
  startBtn.addEventListener('click', handleStart);
  stopBtn.addEventListener('click', handleStop);
  saveSettingsBtn.addEventListener('click', handleSaveSettings);
  openDashboardBtn.addEventListener('click', handleOpenDashboard);
  
  // Listen for state updates from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'stateUpdate') {
      updateUI(message.state);
    }
  });
}

/**
 * Handle start capture button
 */
async function handleStart() {
  console.log('[Hush Popup] Starting capture');
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab || !tab.url?.includes('meet.google.com')) {
    showError('Please open a Google Meet call first');
    return;
  }
  
  // Send message to content script
  chrome.tabs.sendMessage(tab.id, { action: 'startCapture' }, (response) => {
    if (chrome.runtime.lastError) {
      showError('Failed to start capture. Please refresh the Meet page.');
      return;
    }
    
    if (response?.success) {
      showInfo('Capture started! Enable captions in Google Meet if not already on.');
      clearError();
    }
  });
}

/**
 * Handle stop capture button
 */
async function handleStop() {
  console.log('[Hush Popup] Stopping capture');
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab) return;
  
  chrome.tabs.sendMessage(tab.id, { action: 'stopCapture' }, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[Hush Popup] Content script not responding');
      return;
    }
    
    if (response?.success) {
      showInfo('Capture stopped');
      clearError();
    }
  });
}

/**
 * Handle save settings button
 */
function handleSaveSettings() {
  const url = backendUrlInput.value.trim();
  
  if (!url) {
    showError('Backend URL cannot be empty');
    return;
  }
  
  // Validate URL format
  try {
    new URL(url);
  } catch (e) {
    showError('Invalid URL format');
    return;
  }
  
  // Save to storage
  chrome.storage.local.set({ backendUrl: url }, () => {
    showInfo('Settings saved');
    
    // Update content script
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) {
        chrome.tabs.sendMessage(tab.id, { 
          action: 'updateBackendUrl', 
          url 
        });
      }
    });
  });
}

/**
 * Handle open dashboard button
 */
function handleOpenDashboard() {
  const url = backendUrlInput.value.trim();
  chrome.tabs.create({ url: url || 'http://localhost:8501' });
}

/**
 * Update UI based on state
 */
function updateUI(state) {
  currentState = state;
  
  // Update status dot
  if (state.error) {
    statusDot.className = 'status-dot error';
  } else if (state.isCapturing) {
    statusDot.className = 'status-dot active';
  } else {
    statusDot.className = 'status-dot';
  }
  
  // Update buttons
  startBtn.disabled = state.isCapturing;
  stopBtn.disabled = !state.isCapturing;
  
  // Update status info
  if (state.isCapturing) {
    capturingStatus.textContent = 'Active';
    capturingStatus.className = 'status-value active';
  } else {
    capturingStatus.textContent = 'Inactive';
    capturingStatus.className = 'status-value inactive';
  }
  
  captionCount.textContent = state.captionCount || 0;
  
  if (state.lastResponse) {
    backendStatus.textContent = 'Connected';
    backendStatus.className = 'status-value active';
  } else if (state.isCapturing) {
    backendStatus.textContent = 'Connecting...';
    backendStatus.className = 'status-value';
  } else {
    backendStatus.textContent = 'Disconnected';
    backendStatus.className = 'status-value inactive';
  }
  
  sessionId.textContent = state.sessionId || '—';
  
  // Update error
  if (state.error) {
    showError(state.error);
  }
  
  // Update decisions preview
  if (state.lastResponse?.decisions && state.lastResponse.decisions.length > 0) {
    renderDecisions(state.lastResponse.decisions);
  }
}

/**
 * Render decisions in preview
 */
function renderDecisions(decisions) {
  // Keep only last 5 decisions
  const recentDecisions = decisions.slice(-5);
  
  if (recentDecisions.length === 0) {
    decisionPreview.innerHTML = '<div class="empty">No decisions yet</div>';
    return;
  }
  
  decisionPreview.innerHTML = recentDecisions.reverse().map(decision => {
    const verdict = decision.verdict || 'proceed';
    const tool = decision.tool || 'unknown';
    const action = decision.action || '—';
    const confidence = decision.action_confidence 
      ? `${(decision.action_confidence * 100).toFixed(0)}%` 
      : '—';
    const sensitive = decision.contains_sensitive 
      ? `${(decision.contains_sensitive * 100).toFixed(0)}%` 
      : '—';
    
    return `
      <div class="decision-item ${verdict}">
        <div class="decision-header">
          <span class="decision-tool">${tool}</span>
          <span class="decision-verdict">${verdict}</span>
        </div>
        <div class="decision-details">
          Action: ${action} (${confidence}) | Sensitive: ${sensitive}
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Show error message
 */
function showError(message) {
  errorMessage.textContent = message;
  errorAlert.classList.add('show');
  infoAlert.classList.remove('show');
  
  // Auto-clear error after 5 seconds
  setTimeout(clearError, 5000);
}

/**
 * Show info message
 */
function showInfo(message) {
  infoMessage.textContent = message;
  infoAlert.classList.add('show');
  errorAlert.classList.remove('show');
  
  // Auto-clear info after 3 seconds
  setTimeout(() => {
    infoAlert.classList.remove('show');
  }, 3000);
}

/**
 * Clear error message
 */
function clearError() {
  errorAlert.classList.remove('show');
  chrome.runtime.sendMessage({ action: 'clearError' });
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
