// Popup script for Hush Chrome Extension

document.addEventListener('DOMContentLoaded', async () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const backendStatus = document.getElementById('backendStatus');
  const meetingStatus = document.getElementById('meetingStatus');
  const captionStatus = document.getElementById('captionStatus');
  const errorSection = document.getElementById('errorSection');
  const errorMessage = document.getElementById('errorMessage');

  let currentState = {
    isCapturing: false,
    isMeetingActive: false,
    backendConnected: false,
    lastError: null
  };

  // Initialize UI
  updateUI();
  checkStatus();

  // Set up periodic status checks
  setInterval(checkStatus, 2000);

  // Button handlers
  startBtn.addEventListener('click', async () => {
    try {
      startBtn.disabled = true;
      startBtn.textContent = 'Starting...';
      
      const response = await sendMessageToBackground({ type: 'START_CAPTURE_FROM_POPUP' });
      
      if (response.success) {
        currentState.isCapturing = true;
        showSuccess('Capture started successfully');
      } else {
        throw new Error(response.error || 'Failed to start capture');
      }
    } catch (error) {
      showError(`Failed to start capture: ${error.message}`);
    } finally {
      updateUI();
    }
  });

  stopBtn.addEventListener('click', async () => {
    try {
      stopBtn.disabled = true;
      stopBtn.textContent = 'Stopping...';
      
      const response = await sendMessageToBackground({ type: 'STOP_CAPTURE_FROM_POPUP' });
      
      if (response.success) {
        currentState.isCapturing = false;
        showSuccess('Capture stopped');
      } else {
        throw new Error(response.error || 'Failed to stop capture');
      }
    } catch (error) {
      showError(`Failed to stop capture: ${error.message}`);
    } finally {
      updateUI();
    }
  });

  async function checkStatus() {
    try {
      // Check backend connection
      const backendResponse = await sendMessageToBackground({ type: 'CHECK_BACKEND' });
      currentState.backendConnected = backendResponse.connected;

      // Get state from background
      const stateResponse = await sendMessageToBackground({ type: 'GET_STATE' });
      if (stateResponse.success && stateResponse.state) {
        currentState = { ...currentState, ...stateResponse.state };
      }

      // Check if on Google Meet and if captions are available
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0 && tabs[0].url && tabs[0].url.includes('meet.google.com')) {
        try {
          const contentResponse = await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_STATUS' });
          if (contentResponse && contentResponse.success) {
            currentState.isMeetingActive = true;
            currentState.hasCaptions = contentResponse.hasCaptions;
          }
        } catch (error) {
          // Content script might not be loaded yet
          currentState.isMeetingActive = false;
        }
      } else {
        currentState.isMeetingActive = false;
      }

      updateUI();
    } catch (error) {
      console.error('Status check failed:', error);
    }
  }

  function updateUI() {
    // Update backend status
    updateStatusBadge(
      backendStatus,
      currentState.backendConnected,
      'Connected',
      'Disconnected',
      'Checking...'
    );

    // Update meeting status
    updateStatusBadge(
      meetingStatus,
      currentState.isMeetingActive,
      'Active',
      'Not on Meet',
      'Unknown'
    );

    // Update caption status
    if (currentState.isCapturing) {
      captionStatus.textContent = 'Capturing';
      captionStatus.className = 'status-badge status-capturing';
    } else if (currentState.hasCaptions) {
      captionStatus.textContent = 'Available';
      captionStatus.className = 'status-badge status-ok';
    } else if (currentState.isMeetingActive) {
      captionStatus.textContent = 'Enable CC';
      captionStatus.className = 'status-badge status-warning';
    } else {
      captionStatus.textContent = 'Unknown';
      captionStatus.className = 'status-badge status-unknown';
    }

    // Update button states
    const canStart = currentState.backendConnected && 
                     currentState.isMeetingActive && 
                     !currentState.isCapturing;
    
    const canStop = currentState.isCapturing;

    startBtn.disabled = !canStart;
    stopBtn.disabled = !canStop;

    // Reset button text
    if (!startBtn.disabled || currentState.isCapturing) {
      startBtn.innerHTML = '<span class="btn-icon">▶</span> Start Capture';
    }
    if (!stopBtn.disabled || !currentState.isCapturing) {
      stopBtn.innerHTML = '<span class="btn-icon">⬛</span> Stop Capture';
    }

    // Show helpful error messages
    if (!currentState.backendConnected) {
      showError('Hush backend is not running. Please start it on localhost:8501');
    } else if (!currentState.isMeetingActive) {
      showError('Please navigate to an active Google Meet call');
    } else if (currentState.isCapturing && !currentState.hasCaptions) {
      showError('Captions not detected. Please enable captions (CC button) in Google Meet');
    } else if (currentState.lastError) {
      showError(currentState.lastError);
    } else {
      hideError();
    }
  }

  function updateStatusBadge(element, condition, okText, errorText, unknownText) {
    if (condition === true) {
      element.textContent = okText;
      element.className = 'status-badge status-ok';
    } else if (condition === false) {
      element.textContent = errorText;
      element.className = 'status-badge status-error';
    } else {
      element.textContent = unknownText;
      element.className = 'status-badge status-unknown';
    }
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorSection.style.display = 'block';
  }

  function hideError() {
    errorSection.style.display = 'none';
  }

  function showSuccess(message) {
    // Could add a success notification
    console.log('Success:', message);
    hideError();
  }

  function sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  // Listen for state changes from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'STATE_CHANGED') {
      currentState = { ...currentState, ...message.state };
      updateUI();
    }
    sendResponse({ received: true });
  });
});
