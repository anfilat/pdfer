// storage.js — save/restore PDF viewing state per file

/**
 * Key: pdf:<filename>:<filesize>
 * Value: { scrollTop, scrollLeft, rotation, scale, scrollLock }
 */

function storageKey(file) {
  return `pdf:${file.name}:${file.size}`;
}

export function saveState(file, state) {
  try {
    const key = storageKey(file);
    localStorage.setItem(key, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save PDF state:', e);
  }
}

export function loadState(file) {
  try {
    const key = storageKey(file);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearState(file) {
  try {
    localStorage.removeItem(storageKey(file));
  } catch {}
}
