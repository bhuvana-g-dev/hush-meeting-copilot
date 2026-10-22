// Content script for Google Meet caption capture
// Runs on https://meet.google.com/* pages

(function() {
  'use strict';

  let isCapturing = false;
  let captionObserver = null;
  let lastCaptionText = '';
  let captionBuffer = [];
  let captionTimestamp = Date.now();
  const BUFFER_TIMEOUT = 3000; // Send after 3 seconds of no new captions
  const MAX_BUFFER_SIZE = 10; // Or after 10 caption updates
  let bufferTimer = null;

  // Caption selectors for Google Meet
  const CAPTION_SELECTORS = [
    '[jsname="dsyhDe"]', // Primary caption container
    '.iTTPOb', // Caption text spans
    '[data-is-auto-caption="true"]',
    '.a4cQT' // Alternative caption class
  ];

  console.log('[Hush Extension] Content script loaded on Google Meet');

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Hush Extension] Received message:', message);

    if (message.type === 'START_CAPTURE') {
      startCapture();
      sendResponse({ success: true, status: 'capturing' });
    } else if (message.type === 'STOP_CAPTURE') {
      stopCapture();
      sendResponse({ success: true, status: 'stopped' });
    } else if (message.type === 'GET_STATUS') {
      sendResponse({
        success: true,
        isCapturing,
        hasCaptions: !!findCaptionContainer(),
        pageUrl: window.location.href
      });
    }

    return true; // Keep channel open for async response
  });

  function findCaptionContainer() {
    for (const selector of CAPTION_SELECTORS) {
      const element = document.querySelector(selector);
      if (element) {
        console.log('[Hush Extension] Found caption container:', selector);
        return element;
      }
    }
    return null;
  }

  function extractCaptionText(element) {
    if (!element) return null;

    // Try multiple ways to extract caption text
    let text = '';
    
    // Method 1: Direct text content
    const textSpans = element.querySelectorAll('.iTTPOb, span[jsname]');
    if (textSpans.length > 0) {
      text = Array.from(textSpans).map(span => span.textContent.trim()).join(' ');
    }
    
    // Method 2: Direct element text
    if (!text) {
      text = element.textContent.trim();
    }

    return text || null;
  }

  function extractSpeakerName(captionElement) {
    // Try to find speaker name near the caption
    const parent = captionElement.parentElement;
    if (!parent) return null;

    // Look for name elements
    const nameElements = parent.querySelectorAll('[jsname="tAPEie"], .zs7s8d');
    if (nameElements.length > 0) {
      return nameElements[0].textContent.trim();
    }

    return null;
  }

  function processCaptionUpdate() {
    const captionContainer = findCaptionContainer();
    if (!captionContainer) {
      console.log('[Hush Extension] Caption container not found');
      return;
    }

    const currentText = extractCaptionText(captionContainer);
    if (!currentText || currentText === lastCaptionText) {
      return; // No new caption
    }

    console.log('[Hush Extension] New caption:', currentText);

    const speaker = extractSpeakerName(captionContainer) || 'Unknown Speaker';
    
    // Add to buffer
    captionBuffer.push({
      speaker,
      text: currentText,
      timestamp: Date.now()
    });

    lastCaptionText = currentText;

    // Reset buffer timer
    if (bufferTimer) {
      clearTimeout(bufferTimer);
    }

    // Send buffer if it's full or after timeout
    if (captionBuffer.length >= MAX_BUFFER_SIZE) {
      sendCaptionBuffer();
    } else {
      bufferTimer = setTimeout(sendCaptionBuffer, BUFFER_TIMEOUT);
    }
  }

  function sendCaptionBuffer() {
    if (captionBuffer.length === 0) return;

    // Format as Hush expects: [Speaker]: text format
    const transcriptSegment = captionBuffer
      .map(caption => `[${caption.speaker}]: ${caption.text}`)
      .join('\n');

    console.log('[Hush Extension] Sending transcript segment:', transcriptSegment);

    // Send to background script
    chrome.runtime.sendMessage({
      type: 'TRANSCRIPT_SEGMENT',
      data: {
        segment: transcriptSegment,
        captions: captionBuffer,
        timestamp: Date.now()
      }
    });

    // Clear buffer
    captionBuffer = [];
    if (bufferTimer) {
      clearTimeout(bufferTimer);
      bufferTimer = null;
    }
  }

  function startCapture() {
    if (isCapturing) {
      console.log('[Hush Extension] Already capturing');
      return;
    }

    console.log('[Hush Extension] Starting caption capture');
    isCapturing = true;
    lastCaptionText = '';
    captionBuffer = [];

    // Find caption container
    const captionContainer = findCaptionContainer();
    if (!captionContainer) {
      console.warn('[Hush Extension] Caption container not found - captions may not be enabled');
      // Will retry when observer detects changes
    }

    // Set up MutationObserver to watch for caption changes
    captionObserver = new MutationObserver((mutations) => {
      if (isCapturing) {
        processCaptionUpdate();
      }
    });

    // Observe the entire document for caption appearance
    captionObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: false
    });

    // Send status update
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      data: { isCapturing: true }
    });

    console.log('[Hush Extension] Capture started');
  }

  function stopCapture() {
    if (!isCapturing) {
      console.log('[Hush Extension] Not capturing');
      return;
    }

    console.log('[Hush Extension] Stopping caption capture');
    isCapturing = false;

    // Send any remaining buffered captions
    if (captionBuffer.length > 0) {
      sendCaptionBuffer();
    }

    // Disconnect observer
    if (captionObserver) {
      captionObserver.disconnect();
      captionObserver = null;
    }

    if (bufferTimer) {
      clearTimeout(bufferTimer);
      bufferTimer = null;
    }

    // Send status update
    chrome.runtime.sendMessage({
      type: 'STATUS_UPDATE',
      data: { isCapturing: false }
    });

    console.log('[Hush Extension] Capture stopped');
  }

  // Auto-detect if we're on an active meeting page
  function checkMeetingStatus() {
    const isMeetingActive = window.location.pathname.length > 1 && !window.location.pathname.includes('/_meet/');
    console.log('[Hush Extension] Meeting active:', isMeetingActive);
    
    chrome.runtime.sendMessage({
      type: 'MEETING_STATUS',
      data: { isActive: isMeetingActive }
    });
  }

  // Check meeting status on load and URL changes
  checkMeetingStatus();
  
  // Listen for URL changes (Google Meet is a SPA)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      checkMeetingStatus();
      
      // Stop capture if we leave the meeting
      if (!url.includes('meet.google.com/') || url.includes('/_meet/')) {
        stopCapture();
      }
    }
  }).observe(document, { subtree: true, childList: true });

})();
