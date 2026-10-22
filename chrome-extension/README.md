# Hush Meeting Copilot - Chrome Extension

Chrome Extension for Google Meet integration with the Hush AI meeting copilot. Captures live captions from Google Meet and sends them to the Hush backend for real-time decision-making using Strands Decider 2B.

## Features

✅ **Capture Google Meet captions** - Automatically detects and captures visible captions  
✅ **Manual control** - Start/Stop capture on demand via popup interface  
✅ **Real-time processing** - Sends captions to Hush backend in batches (every 3 seconds)  
✅ **Decision preview** - See recent Strands Decider 2B decisions directly in the popup  
✅ **Connection status** - Visual indicators for capture state and backend connectivity  
✅ **Error handling** - Clear error messages with retry logic  
✅ **Configurable backend** - Set custom backend URL for local or deployed instances  

## Prerequisites

1. **Chrome Browser** (version 88 or higher for Manifest V3 support)
2. **Hush Backend Running** - Start the demo server:
   ```bash
   # From project root
   ./kit demo
   # or on Windows
   .\kit.cmd demo
   ```
   The backend should be running at `http://localhost:8501`

3. **Google Meet with Captions** - Captions must be enabled in Google Meet for the extension to capture them

## Installation

### 1. Generate Extension Icons (Required)

The extension needs icons in three sizes. Navigate to `chrome-extension/icons/` and follow the instructions in the README there to generate:
- `icon16.png` (16x16)
- `icon48.png` (48x48)  
- `icon128.png` (128x128)

**Quick placeholder generation:**
```bash
cd chrome-extension/icons
# Create simple orange placeholders with 'H'
convert -size 16x16 xc:#FF9900 -pointsize 10 -fill white -gravity center -annotate +0+0 "H" icon16.png
convert -size 48x48 xc:#FF9900 -pointsize 32 -fill white -gravity center -annotate +0+0 "H" icon48.png
convert -size 128x128 xc:#FF9900 -pointsize 80 -fill white -gravity center -annotate +0+0 "H" icon128.png
```

### 2. Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `chrome-extension/` directory from your project
5. The Hush extension should now appear in your extensions list

### 3. Pin the Extension (Optional)

- Click the puzzle icon in Chrome toolbar
- Find "Hush Meeting Copilot"
- Click the pin icon to keep it visible

## Usage

### 1. Start the Hush Backend

Make sure the Hush demo server is running:
```bash
./kit demo
```

The server will start at `http://localhost:8501`

### 2. Join a Google Meet Call

1. Go to [meet.google.com](https://meet.google.com) and join or start a meeting
2. **Enable captions** in Google Meet:
   - Click the three dots menu
   - Select "Captions" or press `C`
   - Captions should appear at the bottom of the screen

### 3. Start Capturing

1. Click the Hush extension icon in Chrome toolbar
2. Click **▶ Start Capture** button
3. The status dot will turn green when capturing
4. Speak or have others speak - captions will be captured automatically

### 4. Monitor Decisions

- The popup shows:
  - **Capture status** (Active/Inactive)
  - **Caption count** (number of captions captured)
  - **Backend connection** status
  - **Recent decisions** from Strands Decider 2B

- Open the full dashboard:
  - Click **Open Dashboard** in the popup
  - Or visit `http://localhost:8501` directly
  - See full conversation, decisions, and confidence scores

### 5. Stop Capturing

Click **⏹ Stop Capture** in the popup when done.

## Configuration

### Backend URL

The default backend URL is `http://localhost:8501`. To change it:

1. Open the extension popup
2. Scroll to **Settings** section
3. Enter your backend URL (e.g., for deployed instance)
4. Click **Save Settings**

### Advanced Settings

Edit `chrome-extension/content.js` to adjust:
- `captionCheckInterval`: How often to check for new captions (default: 500ms)
- `batchInterval`: How often to send captions to backend (default: 3000ms)
- `maxRetries`: Number of retry attempts on backend failure (default: 3)

## Architecture

### Files

- **`manifest.json`** - Extension configuration (Manifest V3)
- **`content.js`** - Content script injected into Google Meet pages
  - Observes caption DOM elements
  - Buffers and batches captions
  - Sends to backend via `/api/chat` endpoint
- **`background.js`** - Service worker for state management
  - Maintains global extension state
  - Manages badge display
  - Broadcasts updates to popup
- **`popup.html`** - Extension popup UI
- **`popup.js`** - Popup control logic and event handlers
- **`icons/`** - Extension icons (16, 48, 128px)

### Data Flow

```
Google Meet Captions
    ↓
Content Script (content.js)
    ↓ [observes DOM]
Caption Buffer
    ↓ [batches every 3s]
POST /api/chat → Hush Backend
    ↓
Strands Decider 2B Decision
    ↓
Response → Background Script
    ↓
Popup UI Update
```

### Backend Integration

The extension reuses the existing Hush backend API:

**Endpoint:** `POST /api/chat`

**Request:**
```json
{
  "message": "[Alice]: The NDA expires Friday...",
  "session_id": "meet-1234567890-abc123",
  "images": []
}
```

**Response:**
```json
{
  "reply": "Reminder: NDA deadline...",
  "decisions": [
    {
      "pattern": "#guardrails",
      "tool": "interject",
      "action": "INTERJECT",
      "action_confidence": 0.89,
      "contains_sensitive": 0.92,
      "verdict": "proceed"
    }
  ],
  "latency_ms": 1250,
  "model_id": "us.amazon.nova-pro-v1:0"
}
```

## Troubleshooting

### Extension Not Capturing

1. **Check captions are enabled** in Google Meet (press `C` or use menu)
2. **Verify backend is running**: Open `http://localhost:8501` in browser
3. **Check console**: Right-click extension icon → Inspect popup → Console tab
4. **Reload extension**: Go to `chrome://extensions/` and click reload icon
5. **Refresh Meet page**: Reload the Google Meet tab after loading extension

### Backend Connection Failed

1. **Verify backend URL** in extension settings
2. **Check CORS**: Ensure backend allows requests from `chrome-extension://`
3. **Check firewall**: Make sure port 8501 is not blocked
4. **Review backend logs**: Look for errors in the terminal running `./kit demo`

### Captions Not Appearing

Google Meet changed their caption selectors. Update `content.js`:
```javascript
const captionSelectors = [
  '[jsname="YSxPC"]',  // Current selector
  '.a4cQT',            // Alternative
  // Add new selectors here if Google updates their DOM
];
```

### No Decisions Shown

1. **Check backend is processing**: Look at the Hush dashboard
2. **Verify session ID** matches between extension and dashboard
3. **Check decision confidence**: Low confidence decisions may go to human review
4. **Review evaluation cases**: Ensure backend Strands Decider 2B is configured

## Development

### Testing Locally

1. Make changes to extension files
2. Go to `chrome://extensions/`
3. Click reload icon on Hush extension
4. Refresh the Google Meet page
5. Test with the updated code

### Debugging

**Content Script:**
```javascript
// In Google Meet page, open DevTools Console (F12)
// Content script logs appear here
console.log('[Hush] Debug info');
```

**Background Script:**
```javascript
// Go to chrome://extensions/
// Click "Inspect views: service worker" under Hush extension
// Background script logs appear in this console
```

**Popup:**
```javascript
// Right-click extension icon → Inspect popup
// Popup logs appear in this console
```

## Security & Privacy

- **No data storage**: Captions are sent directly to backend, not stored in extension
- **Session-based**: Each Meet session gets a unique session ID
- **No credentials**: Extension never handles API keys or passwords
- **Local by default**: Backend runs locally, no external services
- **User control**: Capture only starts when user clicks "Start Capture"

## Testing

### Manual Testing Checklist

- [ ] Extension loads without errors in `chrome://extensions/`
- [ ] Popup opens and displays correctly
- [ ] Start/Stop buttons toggle correctly
- [ ] Backend connection status updates
- [ ] Captions are captured from Google Meet
- [ ] Captions appear in Hush dashboard
- [ ] Decisions appear in popup preview
- [ ] Error messages display for connection failures
- [ ] Settings save and persist
- [ ] Session ID is maintained across page reloads

### Integration Testing

Run the existing Hush tests to ensure backend compatibility:
```bash
# From project root
./kit setup  # If not done yet
./kit bench  # Run evaluation cases
```

All evaluation cases in `agent/eval_cases.jsonl` should pass.

## Known Limitations

1. **Captions required**: Google Meet must have captions enabled and visible
2. **English only**: Currently optimized for English captions (Google Meet language setting)
3. **DOM changes**: Google may update their caption DOM structure, requiring selector updates
4. **No audio capture**: Extension only captures visible text captions, not audio
5. **Single tab**: One Meet session per browser tab supported

## Future Enhancements

- [ ] Support for other video platforms (Zoom, Teams)
- [ ] Audio capture with Web Audio API
- [ ] Multi-language support
- [ ] Offline mode with local queue
- [ ] Export captured transcripts
- [ ] Custom decision thresholds in UI
- [ ] Integration with Hush dashboard sidebar

## License

Apache-2.0 (same as parent Hush project)

## Credits

Built on the Hush AI meeting copilot by AWS User Group Madurai, powered by Strands Decider 2B.
