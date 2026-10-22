# Google Meet Integration - Installation & Testing Guide

This guide explains how to connect your existing Hush AI Meeting Copilot to Google Meet using the Chrome Extension.

## 🎯 What This Adds

- ✅ **Live caption capture** from Google Meet
- ✅ **Real-time AI analysis** using existing Strands Decider 2B
- ✅ **No changes** to core Hush functionality
- ✅ **Privacy-focused**: only captures visible captions
- ✅ **Existing demo mode** still works

## 📋 Prerequisites

- **Python 3.10+** (already required by Hush)
- **Hush backend** already working
- **Google Chrome** or Chromium-based browser
- **Google Meet** access with caption support

## 🚀 Installation Steps

### Step 1: Verify Existing Hush Works

First, make sure your existing Hush installation works:

```bash
cd /path/to/hush-meeting-copilot

# Set up environment (if not already done)
./kit setup

# Start the demo
./kit demo
```

You should see:
- Hush web UI at `http://localhost:8501`
- Can paste transcript and get AI decisions

**If this doesn't work, fix the base installation first before proceeding.**

### Step 2: Generate Extension Icons

The extension needs icon files. Generate them:

```bash
cd chrome-extension
python generate_icons.py
```

This creates `icons/icon16.png`, `icons/icon48.png`, and `icons/icon128.png`.

**Alternative:** If you don't have Pillow installed, create simple placeholder images manually or skip this (extension will show broken icon but still work).

### Step 3: Load Chrome Extension

1. Open Google Chrome
2. Navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `chrome-extension/` folder from your hush-meeting-copilot directory
6. The extension should appear in your list

**Troubleshooting:**
- **"Manifest file is missing"**: Make sure you selected the `chrome-extension/` folder, not a parent folder
- **"Manifest version not supported"**: Update to Chrome 88+
- **Icon errors**: Run `generate_icons.py` or ignore (won't affect functionality)

### Step 4: Pin Extension to Toolbar

1. Click the puzzle piece icon in Chrome toolbar
2. Find "Hush AI Meeting Copilot"
3. Click the pin icon to keep it visible

### Step 5: Test Connection

1. **Start Hush backend** (if not already running):
   ```bash
   ./kit demo
   ```

2. **Click the extension icon** in Chrome toolbar

3. **Verify status indicators:**
   - **Backend**: Should show "Connected" (green)
   - **Meeting**: Will show "Not on Meet" (gray) - this is normal
   - **Captions**: Will show "Unknown" (gray) - this is normal

4. **If Backend shows "Disconnected":**
   - Verify Hush is running: open `http://localhost:8501` in browser
   - Check terminal for errors
   - Make sure it's running on port 8501

## 🧪 Testing

### Test 1: Backend Connection (No Meeting Required)

1. Start Hush: `./kit demo`
2. Open extension popup
3. Verify "Backend: Connected" shows green

**Expected**: Extension can reach Hush backend.

### Test 2: Manual Transcript Test (No Meeting Required)

1. Open Hush UI: `http://localhost:8501`
2. Paste this test transcript:
   ```
   [Alice]: The NDA with Apex Corp expires this Friday.
   [Bob]: We need to handle this urgently.
   ```
3. Click Send

**Expected**:
- Hush analyzes the transcript
- Shows decision (likely INTERJECT or TAKE_NOTE)
- Decision panel shows confidence scores
- This confirms existing functionality still works

### Test 3: Google Meet Caption Capture (Requires Real Meeting)

**⚠️ This requires an actual Google Meet call. You can:**
- Create a test meeting with yourself (join from two devices)
- Join a real meeting (be mindful of privacy)
- Use Google Meet's "Present in a meeting" feature for testing

**Steps:**

1. **Start Hush backend**:
   ```bash
   ./kit demo
   ```

2. **Join a Google Meet call**:
   - Go to `https://meet.google.com/`
   - Create or join a meeting
   - **Enable captions**: Click the **CC** button in meeting controls
   - Captions should appear at bottom of video

3. **Start Capture**:
   - Click Hush extension icon
   - Verify statuses:
     - Backend: Connected ✓
     - Meeting: Active ✓
     - Captions: Available ✓ (or "Enable CC" if captions not on)
   - Click **Start Capture**

4. **Speak or have others speak**:
   - Say something like: "Let's discuss the Q4 budget"
   - Wait for Google Meet to show the caption
   - Extension captures visible captions automatically

5. **Check Hush Dashboard**:
   - Open `http://localhost:8501` in another tab
   - Look for:
     - Blue transcript boxes with "🎙️ Google Meet Live" label
     - AI decisions appearing in right panel
     - Confidence scores and verdicts

6. **Stop Capture**:
   - Click extension icon
   - Click **Stop Capture**
   - Or leave the meeting

### Test 4: Error Handling

**Test backend disconnection:**
1. Stop Hush backend (Ctrl+C in terminal)
2. Click extension icon
3. Should show "Backend: Disconnected" with helpful error

**Test caption detection:**
1. Join Google Meet without enabling captions
2. Click extension icon
3. Should show "Captions: Enable CC" with instruction

**Test API errors:**
1. Modify `chrome-extension/background.js` to use wrong port (e.g., 9999)
2. Try to start capture
3. Should show error message in popup

## 📊 Run Automated Tests

```bash
# Run all tests including extension integration
python -m pytest tests/ -v

# Run only extension tests
python -m pytest tests/test_extension_integration.py -v

# Run existing tests to verify no regressions
python -m pytest tests/test_agent_contract.py tests/test_tools.py -v
```

**Expected results:**
- All existing tests still pass
- New extension integration tests pass
- No test failures

**Note:** Some extension tests are marked skip by default because they require:
- Real Chrome browser
- Active Google Meet call
- Live caption feed

## 🐛 Debugging

### Extension Not Capturing Captions

**Check content script is loaded:**
1. Open Google Meet in Chrome
2. Press F12 to open DevTools
3. Go to Console tab
4. Look for `[Hush Extension] Content script loaded on Google Meet`

**If not present:**
- Reload the Google Meet tab
- Check `chrome://extensions` - extension should be enabled
- Verify you're on an actual meeting (`meet.google.com/{code}`), not landing page

### No Transcript in Hush Dashboard

**Check browser console:**
1. F12 → Console tab (on Google Meet page)
2. Look for `[Hush Extension] New caption:` logs
3. Should see captions being captured

**Check background worker:**
1. Go to `chrome://extensions`
2. Find Hush extension
3. Click "service worker" link
4. Check console for `[Hush Background]` logs
5. Should see transcript segments being sent

**Check Hush backend:**
- Terminal where `./kit demo` is running
- Should see POST requests to `/api/chat`
- Check for error messages

### AI Decisions Not Appearing

**Verify backend is processing:**
1. Check Hush terminal logs
2. Look for agent execution logs
3. Check for Strands Decider API calls

**Try manual transcript:**
- Go to Hush UI
- Paste a transcript manually
- If decisions work manually but not from extension, it's a communication issue

**Check decision thresholds:**
- Some transcripts may trigger `STAY_SILENT`
- Try more decisive content:
  ```
  [Alice]: The password is abc123 - keep this confidential
  ```
- Should trigger INTERJECT or TAKE_NOTE with high confidence

## ✅ Success Criteria

You've successfully integrated Google Meet when:

1. ✅ Extension loads without errors in `chrome://extensions`
2. ✅ Extension popup shows "Backend: Connected" when Hush is running
3. ✅ In Google Meet, clicking Start Capture enables "Capturing" status
4. ✅ Browser console shows `[Hush Extension] New caption:` logs
5. ✅ Hush dashboard shows transcript segments with "🎙️ Google Meet Live" label
6. ✅ AI decisions appear in decision panel with confidence scores
7. ✅ Existing manual transcript mode still works
8. ✅ All automated tests pass

## 🔐 Privacy & Security Notes

- **No audio/video access**: Extension only reads text captions from DOM
- **Local only**: Data sent to localhost:8501, not external servers
- **Manual start**: Capture only begins when you click Start
- **Transparent**: All processing visible in Hush dashboard
- **Meeting participants**: Extension doesn't notify others you're using AI analysis
- **Google Meet ToS**: Review Google's terms for automated tools

## 📝 What's NOT Tested Yet

The following require manual verification with real meetings:

- ❓ Speaker name detection accuracy (depends on Google Meet)
- ❓ Caption quality with poor audio
- ❓ Performance with long meetings (>1 hour)
- ❓ Behavior with multiple languages
- ❓ Handling of Google Meet UI updates
- ❓ Caption changes/corrections by Google Meet

## 🔄 Rollback

If you need to remove the integration:

**Remove extension:**
1. Go to `chrome://extensions`
2. Find "Hush AI Meeting Copilot"
3. Click Remove

**Revert code changes:**
```bash
git checkout main
git branch -D feature/google-meet-integration
```

**Original Hush still works:**
- The base Hush functionality is unchanged
- Manual transcript mode works exactly as before
- All existing tests pass

## 📚 Next Steps

After successful testing:

1. **Document real-world usage** findings
2. **Report caption detection edge cases**
3. **Optimize buffer timing** based on actual meetings
4. **Add configuration UI** for backend URL
5. **Consider support** for other platforms (Zoom, Teams)

## 🆘 Getting Help

**Extension issues:**
- Check browser console logs
- Review `chrome-extension/README.md`
- Verify Chrome version (need 88+)

**Hush backend issues:**
- Check main project `README.md`
- Verify Python environment
- Run `./kit setup` again

**Integration issues:**
- Review this document
- Check test output: `pytest tests/test_extension_integration.py -v`
- Compare with existing agent contract tests

## 📄 Files Changed

**New files:**
- `chrome-extension/*` - All extension files
- `tests/test_extension_integration.py` - Extension tests
- `GOOGLE_MEET_INTEGRATION.md` - This file

**Modified files:**
- `demo/static/index.html` - Added Meet status indicator
- That's it! No core agent logic changed.

**Unchanged:**
- `agent/` - All agent logic preserved
- `agent/decision.py` - Decider pattern unchanged
- `agent/tools.py` - Tools unchanged
- All other tests and functionality
