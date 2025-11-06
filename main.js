const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

}

const JOURNAL_PATH = path.join(__dirname, 'data', 'journal.json');

function ensureJournalFile() {
  try {
    const dir = path.dirname(JOURNAL_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(JOURNAL_PATH)) {
      fs.writeFileSync(JOURNAL_PATH, JSON.stringify({ entries: [] }, null, 2), 'utf-8');
    }
  } catch (e) {
    console.error('ensureJournalFile error:', e);
  }
}

function readJournal() {
  ensureJournalFile();
  const raw = fs.readFileSync(JOURNAL_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeJournal(data) {
  fs.writeFileSync(JOURNAL_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

ipcMain.handle('journal:getAll', () => {
  const data = readJournal();
  return data.entries;
});

ipcMain.handle('journal:create', (event, payload) => {

  const data = readJournal();
  const now = new Date().toISOString();
  const entry = {
    id: Date.now(),
    surahNumber: Number(payload.surahNumber),
    surahName: payload.surahName || '',
    ayahsCompleted: Number(payload.ayahsCompleted ?? 0),
    note: payload.note || '',
    updatedAt: now
  };

  
  const idx = data.entries.findIndex(e => e.surahNumber === entry.surahNumber);
  if (idx >= 0) data.entries[idx] = { ...data.entries[idx], ...entry, updatedAt: now };
  else data.entries.push(entry);

  writeJournal(data);
  return entry;
});

ipcMain.handle('journal:update', (event, payload) => {
  const data = readJournal();
  const idx = data.entries.findIndex(e => e.id === payload.id);
  if (idx === -1) throw new Error('Entry not found');
  data.entries[idx] = { ...data.entries[idx], ...payload, updatedAt: new Date().toISOString() };
  writeJournal(data);
  return data.entries[idx];
});

ipcMain.handle('journal:delete', (event, id) => {
  const data = readJournal();
  const before = data.entries.length;
  data.entries = data.entries.filter(e => e.id !== id);
  writeJournal(data);
  return { removed: before - data.entries.length };
});

ipcMain.handle('journal:clearBySurah', (event, surahNumber) => {
  const data = readJournal();
  data.entries = data.entries.filter(e => e.surahNumber !== Number(surahNumber));
  writeJournal(data);
  return { ok: true };
});

app.whenReady().then(() => {
  ensureJournalFile();
  createWindow();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });


ipcMain.handle('notes:getAll', () => {
  const data = readJournal();
  if (!Array.isArray(data.entries)) data.entries = [];
  return data.entries;
});

ipcMain.handle('notes:upsert', (event, note) => {
  const data = readJournal();
  if (!Array.isArray(data.entries)) data.entries = [];
  const now = Date.now();
  if (!note.id) note.id = Date.now().toString();
  note.updatedAt = now;

  const idx = data.entries.findIndex(e => e.id === note.id);
  if (idx >= 0) data.entries[idx] = { ...data.entries[idx], ...note, updatedAt: now };
  else data.entries.push(note);

  writeJournal(data);
  return note;
});

ipcMain.handle('notes:delete', (event, id) => {
  const data = readJournal();
  if (!Array.isArray(data.entries)) data.entries = [];
  const before = data.entries.length;
  data.entries = data.entries.filter(e => e.id !== id);
  writeJournal(data);
  return { removed: before - data.entries.length };
});

ipcMain.handle('notes:clear', () => {
  writeJournal({ entries: [] });
  return { ok: true };
});
