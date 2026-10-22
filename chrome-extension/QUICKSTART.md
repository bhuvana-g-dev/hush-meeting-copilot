# Quick Setup Guide - Chrome Extension

## 5-Minute Setup

### Step 1: Generate Icons (2 minutes)

```bash
cd chrome-extension/icons
pip install pillow
python generate_icons.py
```

✅ Creates icon16.png, icon48.png, icon128.png

### Step 2: Load Extension (1 minute)

1. Open Chrome → `chrome://extensions/`
2. Toggle **"Developer mode"** (top right) to ON
3. Click **"Load unpacked"**
4. Navigate to and select the `chrome-extension/` folder
5. ✅ Extension loaded!

### Step 3: Start Backend (1 minute)

```bash
# From project root
./kit demo
```

✅ Backend running at http://localhost:8501

### Step 4: Test in Google Meet (1 minute)

1. Go to https://meet.google.com
2. Join or start a meeting
3. Press **`C`** to enable captions
4. Click **Hush extension icon** in Chrome toolbar
5. Click **"▶ Start Capture"**
6. ✅ Start speaking!

---

## Troubleshooting

### Extension won't load
- **Check:** Do icon files exist in `icons/` folder?
- **Fix:** Run `python generate_icons.py` in icons directory

### "Captions not found" error
- **Check:** Are captions visible in Meet window?
- **Fix:** Press `C` in Meet or use Menu → Captions

### Backend connection failed
- **Check:** Is backend running at http://localhost:8501?
- **Fix:** Run `./kit demo` in project root

### No decisions appearing
- **Check:** Is Hush dashboard showing captions?
- **Fix:** Visit http://localhost:8501 to verify

---

## Where Things Are

```
chrome-extension/
├── manifest.json          ← Extension config
├── content.js             ← Caption capture logic
├── background.js          ← State management
├── popup.html/js          ← UI
└── icons/
    ├── generate_icons.py  ← Run this first!
    └── icon*.png          ← Generated files
```

---

## Useful Commands

```bash
# Generate icons
cd chrome-extension/icons && python generate_icons.py

# Start backend
./kit demo

# Run tests
./kit bench

# View logs
# In Meet tab: F12 → Console
# Extension: chrome://extensions/ → "Inspect views: service worker"
```

---

## Status Indicators

| Badge | Meaning |
|-------|---------|
| 🟢 Green "ON" | Capturing captions |
| ⚫ Gray "OFF" | Not capturing |
| 🔴 Red "ERR" | Connection error |

---

## Quick Links

- **Full Docs:** `chrome-extension/README.md`
- **Testing:** `chrome-extension/TESTING.md`
- **Implementation:** `chrome-extension/IMPLEMENTATION.md`
- **Dashboard:** http://localhost:8501
- **Pull Request:** https://github.com/bhuvana-g-dev/hush-meeting-copilot/pull/2

---

## One-Line Install

```bash
cd chrome-extension/icons && python generate_icons.py && cd ../.. && ./kit demo
```

Then: `chrome://extensions/` → Load unpacked → select `chrome-extension/`

---

**Need help?** See `chrome-extension/TESTING.md` for detailed troubleshooting.
