# 🪙 Paisa — Personal Budget PWA

A minimal, mobile-first Progressive Web App for tracking personal expenses across up to 5 users. Built with vanilla JS + Flask + SQLite.

---

## ✨ Features

- **Multi-user** — Up to 5 users, each with their own data. Optional 4-digit PIN per user.
- **Expense tracking** — Add with amount, category, description, date.
- **Category accordion** — Expenses grouped by category with collapsible cards.
- **Total spending** — Animated total with 7-day mini bar chart.
- **Edit / Delete** — Tap any expense row to edit or delete.
- **PWA** — Installable on Android/iOS, offline viewing via service worker.
- **Dark mode** — Always-on, refined dark theme.

---

## 🚀 Local Setup

### 1. Clone / Download

```bash
git clone <your-repo>
cd budget-pwa
```

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3. Generate icons (optional, creates icons/icon-192.png & 512.png)

```bash
python generate_icons.py
```

> For proper icons, install `cairosvg` first: `pip install cairosvg`

### 4. Run the backend

```bash
python server.py
```

App runs at **http://localhost:5000**

### 5. Open on mobile (same network)

Find your local IP address:
- **Windows:** `ipconfig` → look for IPv4 Address
- **Mac/Linux:** `ifconfig` → look for `inet`

Open `http://YOUR_IP:5000` on your phone's browser.

To install as PWA on Android: tap the browser menu → **"Add to Home Screen"**

---

## ☁️ Deploy to Render (Free)

1. Push code to a GitHub repository.

2. Go to [render.com](https://render.com) and create a free account.

3. Click **New → Web Service** → connect your GitHub repo.

4. Render will auto-detect `render.yaml` and configure everything.

5. Click **Deploy**. Your app will be live at `https://paisa-budget.onrender.com`.

**Important for Render:** Update `DB_PATH` in `server.py` to use the persistent disk:

```python
# In server.py, change line:
DB_PATH = "budget.db"
# To:
DB_PATH = "/data/budget.db"
```

This ensures your SQLite database survives deploys.

---

## 📁 File Structure

```
budget-pwa/
├── index.html          # PWA shell — all screens in one HTML file
├── styles.css          # Mobile-first dark theme styles
├── app.js              # All frontend logic (vanilla JS)
├── server.py           # Flask REST API + SQLite backend
├── sw.js               # Service worker (offline caching)
├── manifest.json       # PWA manifest (installable)
├── requirements.txt    # Python dependencies
├── render.yaml         # Render.com deployment config
├── generate_icons.py   # Icon generator script
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

---

## 🔌 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/users` | List all users |
| POST | `/api/users` | Create user `{ name, pin? }` |
| POST | `/api/users/login` | Login `{ name, pin? }` |
| GET  | `/api/expenses/:user_id?grouped=true` | Get grouped expenses |
| GET  | `/api/expenses/:user_id/summary` | 7-day daily totals |
| POST | `/api/expenses` | Add expense |
| PUT  | `/api/expenses/:id` | Edit expense |
| DELETE | `/api/expenses/:id` | Delete expense |

---

## 📱 PWA Installation

**Android (Chrome):**
1. Open the app URL in Chrome
2. Tap the 3-dot menu → "Add to Home Screen"
3. Tap "Add"

**iOS (Safari):**
1. Open the app URL in Safari
2. Tap the Share button (box with arrow)
3. Scroll and tap "Add to Home Screen"
4. Tap "Add"
