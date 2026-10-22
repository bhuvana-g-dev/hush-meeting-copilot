# Hush Chrome Extension

Chrome Extension for connecting Google Meet captions to Hush AI Meeting Copilot.

## Features

- ✅ Captures visible captions from Google Meet
- ✅ Sends transcript segments to local Hush backend
- ✅ Real-time AI decision analysis
- ✅ Privacy-focused: only captures what you see
- ✅ No audio/video access required

## Installation

### Prerequisites

1. **Hush backend running** on `http://localhost:8501`
   ```bash
   cd /path/to/hush-meeting-copilot
   ./kit demo  # or python -m uvicorn demo.server:app --port 8501
   ```

2. **Google Chrome** or Chromium-based browser (Edge, Brave, etc.)

### Install Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the `chrome-extension` folder from this repository
5. The Hush extension icon should appear in your toolbar

## Usage

### Step 1: Start Hush Backend

```bash
# In the hush-meeting-copilot directory
./kit demo
```

The Hush web interface should open at `http://localhost:8501`

### Step 2: Join Google Meet

1. Open a Google Meet call in Chrome
2. **Enable captions** by clicking the **CC** button in the meeting controls
3. Captions should appear at the bottom of the video

### Step 3: Start Capture

1. Click the **Hush extension icon** in your toolbar
2. Verify status indicators:
   - **Backend**: Should show "Connected"
   - **Meeting**: Should show "Active"
   - **Captions**: Should show "Available" (if CC is on)
3. Click **Start Capture**
4. Open the Hush dashboard at `http://localhost:8501` to see AI decisions

### Step 4: View AI Analysis

In the Hush dashboard, you'll see:
- Live transcript from Google Meet
- AI decisions: INTERJECT / TAKE_NOTE / STAY_SILENT
- Confidence scores and explanations
- Meeting notes and important points

### Step 5: Stop Capture

- Click the extension icon and click **Stop Capture**
- Or simply close/leave the meeting

## How It Works

```
Google Meet Captions
       ↓
Content Script (content.js)
  - Monitors caption DOM changes
  - Extracts speaker + text
  - Buffers caption updates
       ↓
Background Worker (background.js)
  - Formats transcript segment
  - Sends to Hush backend
       ↓
Hush Backend (/api/chat)
  - Strands Decider 2B analysis
  - Returns AI decision
       ↓
Hush Dashboard (index.html)
  - Displays decisions
  - Shows confidence scores
  - Records notes
```

## Troubleshooting

### "Backend: Disconnected"

- Ensure Hush backend is running: `./kit demo`
- Check that it's accessible at `http://localhost:8501`
- Try refreshing the extension popup

### "Captions: Enable CC"

- Click the **CC** button in Google Meet controls
- Captions must be visible for the extension to capture them
- Auto-captions work; you don't need a live captioner

### "Not on Meet" or "Meeting: Not Active"

- Ensure you're on `https://meet.google.com/{meeting-code}`
- The extension only works during active meetings
- Not on the landing page or settings pages

### No Decisions Appearing

- Check browser console (F12) for errors
- Verify captions are actually visible in the meeting
- Check that transcript segments are being sent:
  - Open extension popup
  - Check for "Capturing" status
- Review Hush backend logs for errors

### Extension Icon Missing

- Go to `chrome://extensions`
- Find "Hush AI Meeting Copilot"
- Click the pin icon to show it in toolbar

## Privacy & Security

### What the Extension Accesses

✅ **Visible captions** from Google Meet DOM  
✅ **Your local Hush backend** at localhost:8501  

❌ **NO audio or video** access  
❌ **NO microphone** access  
❌ **NO screen recording**  
❌ **NO external API calls** (except to your local backend)

### Data Flow

1. Captions are read from the visible Google Meet DOM
2. Sent to **your local Hush backend only**
3. Processed by **your local AI models**
4. No data leaves your machine (unless you deployed Hush to AWS)

### Permissions Explained

- `storage`: Save session IDs and preferences locally
- `activeTab`: Read captions from the current Google Meet tab
- `https://meet.google.com/*`: Run content script on Google Meet
- `http://localhost:8501/*`: Send captions to Hush backend

## Development

### Project Structure

```
chrome-extension/
├── manifest.json       # Extension configuration
├── content.js          # Caption capture from Google Meet
├── background.js       # Service worker, API communication
├── popup.html          # Extension popup UI
├── popup.js            # Popup controls and status
├── styles.css          # Popup styling
├── icons/              # Extension icons (16, 48, 128)
└── README.md           # This file
```

### Testing

```bash
# Run Hush tests (includes extension integration)
cd /path/to/hush-meeting-copilot
python -m pytest tests/

# Test caption capture manually
# 1. Load extension in Chrome
# 2. Join a test Google Meet
# 3. Enable captions
# 4. Open DevTools (F12) → Console
# 5. Look for "[Hush Extension]" logs
```

### Debugging

**Content Script** (Google Meet page):
- Open DevTools on the Google Meet tab
- Look for `[Hush Extension]` console logs

**Background Worker**:
- Go to `chrome://extensions`
- Find "Hush AI Meeting Copilot"
- Click "service worker" link
- Console shows background script logs

**Popup**:
- Right-click extension icon → Inspect popup
- Console shows popup script logs

## Limitations

- **Caption accuracy**: Depends on Google Meet's auto-caption quality
- **Speaker detection**: May not always identify speakers correctly
- **Real-time delay**: ~3 seconds between caption and AI analysis
- **Chrome only**: Manifest V3 requires Chromium-based browsers
- **Local backend**: Must run Hush backend on localhost (or update `HUSH_BACKEND_URL` in `background.js`)

## Roadmap

- [ ] Custom backend URL configuration
- [ ] Support for other meeting platforms (Zoom, Teams)
- [ ] Offline mode with local storage
- [ ] Multi-language caption support
- [ ] Advanced speaker identification

## License

Apache-2.0 (same as Hush project)

## Support

For issues related to:
- **Extension**: Check browser console and extension logs
- **Hush backend**: See main project README
- **Google Meet captions**: Check Google Meet help docs
