/* ─── Sekra Budget Tracker — Frontend App ───────────────────────────────────── */
'use strict';

const API = window.location.origin;

// Preset categories
const PRESET_CATEGORIES = [
  { name: 'Len-Den',       emoji: '🤝' },
  { name: 'Transport',     emoji: '🚌' },
  { name: 'Food',          emoji: '🍽️' },
  { name: 'Shopping',      emoji: '🛍️' },
  { name: 'Groceries',     emoji: '🛒' },
  { name: 'Bills',         emoji: '💡' },
  { name: 'Entertainment', emoji: '🎉' },
];

// ─── State ─────────────────────────────────────────────────────────────────────
let currentUser   = null;
let expenses      = [];       // grouped data from API
let editExpenseId = null;
let pinBuffer     = '';
let selectedUser  = null;
let currentEntryType = 'expense';   // 'expense' | 'income'
let selectedCategory = '';
let customCategories = [];          // persisted in localStorage
let deferredInstallPrompt = null;   // PWA install event
let activeDateRange  = 'all';        // 'all' | 'today' | 'week' | 'month' | 'custom'
let exportMode      = 'month';       // 'month' | 'range'
let filterDateFrom  = '';           // YYYY-MM-DD
let filterDateTo    = '';           // YYYY-MM-DD

// ─── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  registerSW();
  initOfflineDetection();
  initInstallPrompt();
  buildPinKeypad('setup-pin-keypad',  handleSetupPin);
  buildPinKeypad('verify-pin-keypad', handleVerifyPin);
  setTodayDate();
  loadUsers();

  // Restore custom categories from localStorage
  const saved = localStorage.getItem('sekra_custom_cats');
  if (saved) customCategories = JSON.parse(saved);

  // Restore session
  const savedUser = localStorage.getItem('sekra_user');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    enterApp();
  }

  // Category search input
  document.getElementById('cat-search').addEventListener('input', filterCategoryList);

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    const wrap = document.getElementById('cat-dropdown-wrap');
    if (wrap && !wrap.contains(e.target)) closeCatDropdown();
  });

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target === el) closeModal(el.id);
    });
  });

  // New-user name → show PIN setup
  document.getElementById('new-user-name').addEventListener('input', (e) => {
    const hasNew = e.target.value.trim().length > 0 && !selectedUser;
    document.getElementById('pin-setup-group').classList.toggle('hidden', !hasNew);
  });

  document.getElementById('login-btn').addEventListener('click', handleLogin);
});

// ─── Service Worker ────────────────────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

function initOfflineDetection() {
  const banner = document.getElementById('offline-banner');
  const update = () => banner.classList.toggle('visible', !navigator.onLine);
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

// ─── PWA Install Prompt ────────────────────────────────────────────────────────
function initInstallPrompt() {
  // Capture the install event before it fires
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;

    // Don't show if already dismissed
    if (localStorage.getItem('sekra_install_dismissed')) return;

    const banner = document.getElementById('install-banner');
    banner.classList.remove('hidden');
  });

  // Install button
  document.getElementById('install-btn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.getElementById('install-banner').classList.add('hidden');
    if (outcome === 'accepted') toast('App installed! 🎉', 'success');
  });

  // Dismiss button
  document.getElementById('install-dismiss').addEventListener('click', () => {
    document.getElementById('install-banner').classList.add('hidden');
    localStorage.setItem('sekra_install_dismissed', '1');
  });

  // Hide banner once installed
  window.addEventListener('appinstalled', () => {
    document.getElementById('install-banner').classList.add('hidden');
  });
}

// ─── API ───────────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── Navigation ────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function navTo(screenId, navId) {
  showScreen(screenId);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(navId).classList.add('active');
  if (screenId === 'profile-screen') updateProfileScreen();
}

// ─── Login ─────────────────────────────────────────────────────────────────────
async function loadUsers() {
  try {
    const users = await apiFetch('/api/users');
    renderUserGrid(users);
  } catch {}
}

function renderUserGrid(users) {
  const grid = document.getElementById('user-grid');
  grid.innerHTML = '';
  users.forEach(u => {
    const chip = document.createElement('div');
    chip.className = 'user-chip';
    chip.innerHTML = `
      <div class="chip-avatar">${initials(u.name)}</div>
      <span class="chip-name">${u.name}</span>
    `;
    chip.addEventListener('click', () => {
      selectedUser = u;
      document.querySelectorAll('.user-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      document.getElementById('new-user-name').value = '';
      document.getElementById('pin-setup-group').classList.add('hidden');
    });
    grid.appendChild(chip);
  });
}

async function handleLogin() {
  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  try {
    if (selectedUser) {
      try {
        const result = await apiFetch('/api/users/login', {
          method: 'POST', body: JSON.stringify({ name: selectedUser.name })
        });
        currentUser = result; persistUser(); enterApp();
      } catch (err) {
        if (err.message.includes('PIN')) openPinModal(selectedUser);
        else toast(err.message, 'error');
      }
    } else {
      const name = document.getElementById('new-user-name').value.trim();
      if (!name) { toast('Enter your name or select a user', 'error'); return; }
      const pin = pinBuffer.length === 4 ? pinBuffer : null;
      const user = await apiFetch('/api/users', {
        method: 'POST', body: JSON.stringify({ name, pin })
      });
      currentUser = user; persistUser(); enterApp();
    }
  } catch (err) {
    toast(err.message || 'Login failed', 'error');
  } finally {
    btn.disabled = false;
    pinBuffer = '';
    updatePinDots('setup-pin-dots', 0);
  }
}

function openPinModal(user) {
  document.getElementById('pin-modal-user').textContent = `Welcome back, ${user.name}`;
  pinBuffer = '';
  updatePinDots('verify-pin-dots', 0);
  openModal('pin-modal');
}

async function verifyAndLogin(pin) {
  try {
    const result = await apiFetch('/api/users/login', {
      method: 'POST', body: JSON.stringify({ name: selectedUser.name, pin })
    });
    closeModal('pin-modal');
    currentUser = result; persistUser(); enterApp();
  } catch {
    toast('Wrong PIN — try again', 'error');
    pinBuffer = ''; updatePinDots('verify-pin-dots', 0);
  }
}

function persistUser() {
  localStorage.setItem('sekra_user', JSON.stringify(currentUser));
}

function enterApp() {
  document.getElementById('header-avatar').textContent   = initials(currentUser.name);
  document.getElementById('header-username').textContent = currentUser.name.split(' ')[0];
  document.getElementById('bottom-nav').style.display    = 'flex';
  showScreen('dashboard-screen');
  loadExpenses();
  loadMiniChart();
}

function logout() {
  if (!confirm('Switch user?')) return;
  localStorage.removeItem('sekra_user');
  currentUser = null; selectedUser = null; expenses = [];
  document.getElementById('bottom-nav').style.display = 'none';
  document.querySelectorAll('.user-chip').forEach(c => c.classList.remove('selected'));
  document.getElementById('new-user-name').value = '';
  document.getElementById('pin-setup-group').classList.add('hidden');
  loadUsers();
  showScreen('login-screen');
}

// ─── Load & Render Expenses ────────────────────────────────────────────────────
async function loadExpenses() {
  const container = document.getElementById('categories-container');
  container.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  try {
    const params = buildDateParams();
    const data = await apiFetch(`/api/expenses/${currentUser.id}?grouped=true${params}`);
    expenses = data;

    // Merge any server-known categories into custom list
    if (data.used_categories) {
      data.used_categories.forEach(cat => {
        if (!PRESET_CATEGORIES.find(p => p.name === cat) && !customCategories.includes(cat)) {
          customCategories.push(cat);
        }
      });
      saveCustomCategories();
    }

    renderCategories(data.groups);
    updateTotals(data);
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Could not load. ${err.message}</p>
      </div>`;
  }
}

// ─── Export PDF ────────────────────────────────────────────────────────────────
function openExportModal() {
  // Populate month select
  const monthSel = document.getElementById('export-month');
  if (!monthSel.options.length) {
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    months.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = i + 1;
      opt.textContent = m;
      monthSel.appendChild(opt);
    });
    monthSel.value = new Date().getMonth() + 1;
  }

  // Populate year select (current year back 3)
  const yearSel = document.getElementById('export-year');
  if (!yearSel.options.length) {
    const cur = new Date().getFullYear();
    for (let y = cur; y >= cur - 3; y--) {
      const opt = document.createElement('option');
      opt.value = y; opt.textContent = y;
      yearSel.appendChild(opt);
    }
    yearSel.value = cur;
  }

  // Default range dates
  const today = new Date().toISOString().slice(0, 10);
  const fromD = new Date(); fromD.setDate(1);
  document.getElementById('export-date-from').value = fromD.toISOString().slice(0,10);
  document.getElementById('export-date-to').value   = today;

  setExportMode('month');
  openModal('export-modal');
}

function setExportMode(mode) {
  exportMode = mode;
  document.getElementById('export-btn-month').classList.toggle('active', mode === 'month');
  document.getElementById('export-btn-range').classList.toggle('active', mode === 'range');
  document.getElementById('export-month-panel').classList.toggle('hidden', mode !== 'month');
  document.getElementById('export-range-panel').classList.toggle('hidden', mode !== 'range');
}

function doExportPDF() {
  if (!currentUser) return;
  const detailed = document.getElementById('export-detailed').checked;
  let url = `/api/export/pdf?user_id=${currentUser.id}&detailed=${detailed}`;

  if (exportMode === 'month') {
    const month = document.getElementById('export-month').value;
    const year  = document.getElementById('export-year').value;
    url += `&mode=month&month=${month}&year=${year}`;
  } else {
    const from = document.getElementById('export-date-from').value;
    const to   = document.getElementById('export-date-to').value;
    if (!from || !to) { toast('Please select both dates', 'error'); return; }
    if (from > to)    { toast('From date must be before To date', 'error'); return; }
    url += `&mode=range&date_from=${from}&date_to=${to}`;
  }

  toast('Generating PDF…', 'success');
  closeModal('export-modal');
  // Trigger download via hidden anchor
  const a = document.createElement('a');
  a.href = url; a.download = ''; a.style.display = 'none';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
}

// ─── Date Filter ───────────────────────────────────────────────────────────────
function buildDateParams() {
  const today = new Date().toISOString().slice(0, 10);
  if (activeDateRange === 'today') {
    return `&date_from=${today}&date_to=${today}`;
  }
  if (activeDateRange === 'week') {
    const from = new Date();
    from.setDate(from.getDate() - from.getDay()); // Sunday
    return `&date_from=${from.toISOString().slice(0,10)}&date_to=${today}`;
  }
  if (activeDateRange === 'month') {
    const from = new Date();
    from.setDate(1);
    return `&date_from=${from.toISOString().slice(0,10)}&date_to=${today}`;
  }
  if (activeDateRange === 'custom' && filterDateFrom) {
    let p = `&date_from=${filterDateFrom}`;
    if (filterDateTo) p += `&date_to=${filterDateTo}`;
    return p;
  }
  return '';
}

function setDateFilter(btn) {
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  activeDateRange = btn.dataset.range;
  const customPanel = document.getElementById('date-filter-custom');
  if (activeDateRange === 'custom') {
    customPanel.classList.remove('hidden');
    // Pre-fill sensible defaults if empty
    const today = new Date().toISOString().slice(0, 10);
    if (!filterDateFrom) {
      const from = new Date(); from.setDate(1);
      filterDateFrom = from.toISOString().slice(0, 10);
      document.getElementById('filter-date-from').value = filterDateFrom;
    }
    if (!filterDateTo) {
      filterDateTo = today;
      document.getElementById('filter-date-to').value = filterDateTo;
    }
  } else {
    customPanel.classList.add('hidden');
  }
  loadExpenses();
}

function applyCustomFilter() {
  filterDateFrom = document.getElementById('filter-date-from').value;
  filterDateTo   = document.getElementById('filter-date-to').value;
  if (filterDateFrom) loadExpenses();
}

function renderCategories(groups) {
  const container = document.getElementById('categories-container');
  if (!groups || groups.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💸</div>
        <p>No entries yet.<br>Tap <strong>+</strong> to add your first one.</p>
      </div>`;
    return;
  }
  container.innerHTML = '<div class="categories-list"></div>';
  const list = container.querySelector('.categories-list');
  groups.forEach(group => {
    const card = document.createElement('div');
    card.className = 'category-card' + (group._is_income ? ' income-card' : '');
    card.innerHTML = buildCategoryCard(group);
    list.appendChild(card);
    card.querySelector('.category-header').addEventListener('click', () => {
      card.classList.toggle('expanded');
    });
  });
}

function buildCategoryCard(group) {
  const icon = group._is_income ? '💰' : getCategoryIcon(group.category);
  const items = group.expenses.map(e => buildExpenseItem(e, group._is_income)).join('');
  return `
    <div class="category-header">
      <div class="cat-icon">${icon}</div>
      <div class="cat-info">
        <div class="cat-name">${esc(group.category)}</div>
        <div class="cat-count">${group.expenses.length} item${group.expenses.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="cat-total">${group._is_income ? '+' : '-'}₹${fmt(group.total)}</div>
      <svg class="cat-chevron" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
      </svg>
    </div>
    <div class="expense-list">
      <div class="expense-list-inner">${items}</div>
    </div>`;
}

function buildExpenseItem(exp, isIncome) {
  const desc  = exp.description || '—';
  const sign  = exp.type === 'income' ? '+' : '-';
  const cls   = exp.type === 'income' ? 'income' : 'expense';
  return `
    <div class="expense-item">
      <div class="expense-dot"></div>
      <div class="expense-info">
        <div class="expense-desc">${esc(desc)}</div>
        <div class="expense-date">${formatDate(exp.date)}</div>
      </div>
      <div class="expense-amount ${cls}">${sign}₹${fmt(exp.amount)}</div>
      <div class="expense-actions">
        <button class="btn-icon" onclick="editExpense(${exp.id})" title="Edit">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
          </svg>
        </button>
        <button class="btn-icon" onclick="deleteExpense(${exp.id})" title="Delete" style="color:var(--danger)">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </button>
      </div>
    </div>`;
}

function updateTotals(data) {
  const balance   = data.balance       || 0;
  const income    = data.total_income  || 0;
  const expense   = data.total_expense || 0;
  const count     = (data.groups || []).reduce((s, g) => s + g.expenses.length, 0);

  // Balance (main number) — show negative sign in the currency symbol span
  const balEl  = document.getElementById('balance-amount');
  const symEl  = balEl.closest('.total-amount')?.querySelector('.currency-sym');
  animateCount(balEl, Math.abs(balance));
  balEl.classList.toggle('negative', balance < 0);
  balEl.classList.toggle('positive', balance >= 0);
  if (symEl) symEl.textContent = balance < 0 ? '-₹' : '₹';

  document.getElementById('total-income-val').textContent  = '₹' + fmt(income);
  document.getElementById('total-expense-val').textContent = '₹' + fmt(expense);
  document.getElementById('expense-count').textContent     = count;

  // Profile
  document.getElementById('stat-balance').textContent = (balance < 0 ? '-' : '') + '₹' + fmt(Math.abs(balance));
  document.getElementById('stat-count').textContent   = count;
}

// ─── Mini Chart ────────────────────────────────────────────────────────────────
async function loadMiniChart() {
  const chart = document.getElementById('mini-chart');
  chart.innerHTML = '';
  try {
    const data = await apiFetch(`/api/expenses/${currentUser.id}/summary`);
    if (!data.length) return;
    const days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const row = data.find(r => r.date === key);
      days.push({ key, total: row ? row.total : 0, isToday: i === 0 });
    }
    const max = Math.max(...days.map(d => d.total), 1);
    const dayNames = ['S','M','T','W','T','F','S'];
    days.forEach(d => {
      const pct = Math.max((d.total / max) * 100, 4);
      const dn  = dayNames[new Date(d.key + 'T00:00:00').getDay()];
      const wrap = document.createElement('div');
      wrap.className = 'chart-bar-wrap';
      wrap.innerHTML = `
        <div class="chart-bar${d.isToday ? ' today' : ''}" style="height:${pct}%"></div>
        <div class="chart-day">${d.isToday ? '•' : dn}</div>`;
      chart.appendChild(wrap);
    });
  } catch {}
}

// ─── Add / Edit Entry ──────────────────────────────────────────────────────────
function openAddModal() {
  editExpenseId   = null;
  document.getElementById('modal-title').textContent      = 'Add Entry';
  document.getElementById('save-expense-btn').textContent = 'Save Entry';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-desc').value   = '';
  setTodayDate();
  setEntryType('expense');
  setCategorySelection('');
  openModal('expense-modal');
  setTimeout(() => document.getElementById('exp-amount').focus(), 300);
}

function editExpense(id) {
  let target = null;
  for (const group of (expenses.groups || [])) {
    target = group.expenses.find(e => e.id === id);
    if (target) break;
  }
  if (!target) return;

  editExpenseId = id;
  document.getElementById('modal-title').textContent      = 'Edit Entry';
  document.getElementById('save-expense-btn').textContent = 'Update Entry';
  document.getElementById('exp-amount').value = target.amount;
  document.getElementById('exp-desc').value   = target.description || '';
  document.getElementById('exp-date').value   = target.date;
  setEntryType(target.type || 'expense');
  setCategorySelection(target.category || '');
  openModal('expense-modal');
}

async function saveExpense() {
  const amount   = parseFloat(document.getElementById('exp-amount').value);
  const category = selectedCategory || 'Uncategorized';
  const desc     = document.getElementById('exp-desc').value.trim();
  const date     = document.getElementById('exp-date').value;
  const type     = currentEntryType;

  if (!amount || amount <= 0) { toast('Please enter a valid amount', 'error'); return; }

  const btn = document.getElementById('save-expense-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    if (editExpenseId) {
      await apiFetch(`/api/expenses/${editExpenseId}`, {
        method: 'PUT',
        body: JSON.stringify({ amount, type, category, description: desc, date })
      });
      toast('Entry updated ✓', 'success');
    } else {
      await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({ user_id: currentUser.id, amount, type, category, description: desc, date })
      });
      toast('Entry added ✓', 'success');
    }
    closeModal('expense-modal');
    loadExpenses(); loadMiniChart();
  } catch (err) {
    toast(err.message || 'Failed to save', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = editExpenseId ? 'Update Entry' : 'Save Entry';
  }
}

async function deleteExpense(id) {
  if (!confirm('Delete this entry?')) return;
  try {
    await apiFetch(`/api/expenses/${id}`, { method: 'DELETE' });
    toast('Entry deleted', 'success');
    loadExpenses(); loadMiniChart();
  } catch (err) {
    toast(err.message || 'Delete failed', 'error');
  }
}

// ─── Entry Type Toggle ─────────────────────────────────────────────────────────
function setEntryType(type) {
  currentEntryType = type;
  document.getElementById('btn-expense').classList.toggle('active', type === 'expense');
  document.getElementById('btn-income').classList.toggle('active',  type === 'income');
  // Category field shown for both expense and income
  document.getElementById('category-field').style.display = '';
}

// ─── Category Dropdown ─────────────────────────────────────────────────────────
function getAllCategories() {
  const all = [...PRESET_CATEGORIES.map(c => ({ ...c, custom: false }))];
  customCategories.forEach(name => {
    if (!all.find(c => c.name === name)) {
      all.push({ name, emoji: '🏷️', custom: true });
    }
  });
  return all;
}

function toggleCatDropdown() {
  const panel   = document.getElementById('cat-dropdown-panel');
  const trigger = document.getElementById('cat-dropdown-trigger');
  const isOpen  = !panel.classList.contains('hidden');
  if (isOpen) {
    closeCatDropdown();
  } else {
    panel.classList.remove('hidden');
    trigger.classList.add('open');
    populateCategoryList('');
    document.getElementById('cat-search').value = '';
    document.getElementById('cat-search').focus();
  }
}

function closeCatDropdown() {
  document.getElementById('cat-dropdown-panel').classList.add('hidden');
  document.getElementById('cat-dropdown-trigger').classList.remove('open');
  document.getElementById('cat-add-custom').classList.add('hidden');
}

function filterCategoryList() {
  const q = document.getElementById('cat-search').value.trim();
  populateCategoryList(q);
}

function populateCategoryList(query) {
  const list = document.getElementById('cat-dropdown-list');
  const cats  = getAllCategories();
  const q     = query.toLowerCase();
  const filtered = q ? cats.filter(c => c.name.toLowerCase().includes(q)) : cats;

  list.innerHTML = '';
  filtered.forEach(cat => {
    const opt = document.createElement('div');
    opt.className = 'cat-option' + (cat.custom ? ' custom-tag' : '') +
                    (selectedCategory === cat.name ? ' selected' : '');
    opt.innerHTML = `<span class="cat-emoji">${cat.emoji}</span>${esc(cat.name)}`;
    opt.addEventListener('click', () => {
      setCategorySelection(cat.name);
      closeCatDropdown();
    });
    list.appendChild(opt);
  });

  // Show "add custom" if query doesn't match any existing
  const addBtn  = document.getElementById('cat-add-custom');
  const addLbl  = document.getElementById('cat-add-label');
  const matches = cats.some(c => c.name.toLowerCase() === q);
  if (q && !matches) {
    addLbl.textContent = query;
    addBtn.classList.remove('hidden');
  } else {
    addBtn.classList.add('hidden');
  }
}

function setCategorySelection(name) {
  selectedCategory = name;
  document.getElementById('exp-category').value = name;
  const lbl = document.getElementById('cat-selected-label');
  if (name) {
    const cat = getAllCategories().find(c => c.name === name);
    lbl.textContent = cat ? `${cat.emoji} ${cat.name}` : name;
    lbl.style.color = 'var(--text)';
  } else {
    lbl.textContent = 'Select category…';
    lbl.style.color = '';
  }
}

function addCustomCategory() {
  const q = document.getElementById('cat-search').value.trim();
  if (!q) return;
  if (!customCategories.includes(q)) {
    customCategories.push(q);
    saveCustomCategories();
  }
  setCategorySelection(q);
  closeCatDropdown();
  toast(`Category "${q}" saved`, 'success');
}

function saveCustomCategories() {
  localStorage.setItem('sekra_custom_cats', JSON.stringify(customCategories));
}

// ─── PIN Keypad ────────────────────────────────────────────────────────────────
function buildPinKeypad(containerId, handler) {
  const container = document.getElementById(containerId);
  ['1','2','3','4','5','6','7','8','9','','0','⌫'].forEach(k => {
    const btn = document.createElement('button');
    btn.className = 'pin-key' + (k === '⌫' ? ' del' : '');
    btn.textContent = k;
    if (k === '') { btn.style.visibility = 'hidden'; }
    else btn.addEventListener('click', () => handler(k));
    container.appendChild(btn);
  });
}

function handleSetupPin(key) {
  if (key === '⌫') pinBuffer = pinBuffer.slice(0, -1);
  else if (pinBuffer.length < 4) pinBuffer += key;
  updatePinDots('setup-pin-dots', pinBuffer.length);
}

function handleVerifyPin(key) {
  if (key === '⌫') pinBuffer = pinBuffer.slice(0, -1);
  else if (pinBuffer.length < 4) {
    pinBuffer += key;
    if (pinBuffer.length === 4) verifyAndLogin(pinBuffer);
  }
  updatePinDots('verify-pin-dots', pinBuffer.length);
}

function updatePinDots(id, count) {
  document.querySelectorAll(`#${id} .pin-dot`).forEach((d, i) =>
    d.classList.toggle('filled', i < count));
}

// ─── Profile ───────────────────────────────────────────────────────────────────
function updateProfileScreen() {
  if (!currentUser) return;
  document.getElementById('profile-avatar-lg').textContent    = initials(currentUser.name);
  document.getElementById('profile-name-display').textContent = currentUser.name;
}

// ─── Modals ────────────────────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
  closeCatDropdown();
}

// ─── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const c  = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className  = `toast ${type}`;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ─── Utilities ─────────────────────────────────────────────────────────────────
function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0,2);
}
function fmt(n) {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function setTodayDate() {
  document.getElementById('exp-date').value = new Date().toISOString().slice(0,10);
}
function formatDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN',
    { day:'numeric', month:'short', year:'numeric' });
}
function getCategoryIcon(cat) {
  const m = PRESET_CATEGORIES.find(c => c.name.toLowerCase() === (cat||'').toLowerCase());
  return m ? m.emoji : '📦';
}
function animateCount(el, target) {
  const start = parseFloat(el.textContent.replace(/,/g,'')) || 0;
  const diff  = target - start;
  const steps = 24;
  let i = 0;
  const tick = () => {
    i++;
    el.textContent = fmt(Math.round((start + diff * (i/steps)) * 100) / 100);
    if (i < steps) requestAnimationFrame(tick);
    else el.textContent = fmt(target);
  };
  requestAnimationFrame(tick);
}