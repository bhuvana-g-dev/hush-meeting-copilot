# Hush: AI Meeting Copilot & In-Meeting Wingman

**An intelligent in-meeting personal AI wingman for Google Meet powered by Strands Decider 2B.**  
It listens to live meeting speech, keeps track of your personal meeting aims/goals, wakes you up when your key topic is discussed, suggests well-timed doubt questions to overcome hesitation, captures structured notes automatically, and neatly tucks itself aside so it never disturbs your call.

---

## 🔗 Quick Links for Judges & Reviewers

- 🌐 **Live Deployed Backend:** [https://hush-meeting-copilot.onrender.com](https://hush-meeting-copilot.onrender.com)
- 💻 **GitHub Repository:** [https://github.com/bhuvana-g-dev/hush-meeting-copilot](https://github.com/bhuvana-g-dev/hush-meeting-copilot)
- 📦 **Download Chrome Extension (Ready-to-Use Zip):** [Download hush-chrome-extension.zip](https://github.com/bhuvana-g-dev/hush-meeting-copilot/raw/main/hush-chrome-extension.zip)

---

## ⚡ 2-Minute Quick Start (Try It Live in Google Meet!)

No Python, command-line, or API key configuration is required to test! The extension is pre-configured to connect to our production Render backend.

1. **Download & Extract Extension:**
   - Download [`hush-chrome-extension.zip`](https://github.com/bhuvana-g-dev/hush-meeting-copilot/raw/main/hush-chrome-extension.zip) and unzip it into a folder.
2. **Load into Google Chrome:**
   - Open `chrome://extensions` in Chrome.
   - Enable **Developer mode** (top-right toggle).
   - Click **Load unpacked** and select the unzipped `chrome-extension/` directory.
3. **Experience it in Google Meet:**
   - Join any call on [Google Meet](https://meet.google.com).
   - Turn on **Captions (`CC`)** at the bottom of Google Meet.
   - Hush AI Copilot appears seamlessly on the right edge!

---

## 🌟 Key Features

### 1. 🫸 Edge-Docking & Auto-Peek Mode ("Zero Meeting Disturbance")
- **Tucks aside:** Sits quietly on the right screen edge (`🎯 HUSH AI ❮`) taking only 36px so it never blocks video tiles or presentations.
- **Listens from aside:** Continuously listens to Google Meet captions in real time.
- **Auto Slide-Out:** When your topic is discussed or when questions are invited, it chimes and slides out smoothly into view!
- **Auto Slide-In:** Includes an auto-hide countdown with hover protection (stays open while your mouse is over it, slides back in when you're done).
- **Size Toggle (`↔️ Size`):** Switch between Standard (450px), Large (530px), and Compact (380px) with one click.

### 2. ⚡ Zone-Out Recovery & Focus Alert
- Long 1-2 hour lectures and meetings often lead to zoning out.
- Set any goal (e.g. *"Learn Full Stack Development"*, *"Review Project Roadmap"*, *"Interview Prep"*).
- When the speaker talks about your goal, Hush rings a gentle audio chime and presents an instant **1-sentence catch-up summary** of what was just said so you can re-engage immediately.

### 3. 🎤 Hesitation-Buster Doubt Suggestions
- Many attendees hesitate to speak up or formulate questions on the spot.
- When the speaker pauses or opens the floor, Hush detects the opportune moment and crafts 1-3 sharp, contextual questions.
- **Confidence Booster Tip:** Gives real-time encouraging tips to ask right away.
- **1-Click "💬 Paste to Meet Chat":** Automatically opens Google Meet's chat drawer and pastes the question into the message box!

### 4. 📝 Live Auto-Notes Tab
- Automatically extracts and categorizes information as people speak:
  - ⚡ **Core Concepts & Tech:** Key architectural terms, definitions, and tools.
  - 📌 **Action Items:** Deadlines, tasks, and commitments.
  - 💡 **Decisions:** Concluded choices and team agreements.
  - ✍️ **Manual Notes:** Attendee can type their own quick notes anytime.

### 5. 📜 Live Transcript & 1-Click Markdown Export
- Full chronological transcript with timestamps `[HH:MM:SS]` and speaker attribution.
- **📥 Export Button:** 1-click download of a structured Markdown summary (`meeting-summary-YYYY-MM-DD.md`) containing your goal, categorized notes, and the full transcript!

---

## 🧠 Decision Architecture (Strands Decider 2B)

Hush uses **Strands Decider 2B** at the core of its decision pipeline:
1. **Relevance Gate:** Determines if live transcript turns are relevant to the user's personal goal (`#wingman`).
2. **Cue Policy:** Selects `FOCUS_ALERT`, `ASK_DOUBT`, `GOAL_RESOLVED`, or `STAY_SILENT` in a single fast forward pass (<200ms).
3. **Calibrated Action:** If routine conversation is detected, Hush stays silent so the attendee is never interrupted unnecessarily.

---

## 🛠️ Local Development & Backend Setup

To run the backend locally instead of using the Render cloud:

```bash
# Clone the repository
git clone https://github.com/bhuvana-g-dev/hush-meeting-copilot.git
cd hush-meeting-copilot

# Set up virtual environment
python -m venv .venv
.\.venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the test suite (18/18 passing)
python run_tests.py

# Start local server
python -m uvicorn demo.server:app --port 8501
```

---

## 📋 Hackathon Submission Details

- **Event:** Strands Decider Hackathon (AWS User Group Madurai)
- **Decision Pattern:** `#guardrails` / `#wingman`
- **Agent Core / Backend:** Strands Decider 2B + FastAPI
- **Frontend / In-Meeting HUD:** Chrome Extension (Manifest V3) for Google Meet
- **Repository:** [https://github.com/bhuvana-g-dev/hush-meeting-copilot](https://github.com/bhuvana-g-dev/hush-meeting-copilot)
- **Live Demo URL:** [https://hush-meeting-copilot.onrender.com](https://hush-meeting-copilot.onrender.com)
