// pdf-store.js — persist last-opened PDF via Origin Private File System (OPFS)

const FILE_NAME = 'last-opened.pdf';
const META_KEY = 'opfs:pdfMeta';

function isAvailable() {
  return 'storage' in navigator && 'getDirectory' in navigator.storage;
}

async function getOpfsRoot() {
  return await navigator.storage.getDirectory();
}

/**
 * Save a PDF file to OPFS. Also stores file metadata in localStorage
 * so we can reconstruct the original File with the correct name.
 */
export async function savePdf(file) {
  if (!isAvailable()) {
    console.warn('OPFS not available — PDF will not be persisted');
    return;
  }

  const root = await getOpfsRoot();
  const handle = await root.getFileHandle(FILE_NAME, { create: true });
  const writable = await handle.createWritable();
  await writable.write(file);
  await writable.close();

  localStorage.setItem(
    META_KEY,
    JSON.stringify({
      name: file.name,
      size: file.size,
      type: file.type,
    })
  );
}

/**
 * Load the last-saved PDF from OPFS.
 * Returns a File with the original name, or null if nothing is saved.
 */
export async function loadPdf() {
  if (!isAvailable()) return null;

  try {
    const root = await getOpfsRoot();
    const handle = await root.getFileHandle(FILE_NAME);
    const storedFile = await handle.getFile();

    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;

    const meta = JSON.parse(raw);
    // Reconstruct File with original name (needed for storage key: pdf:<name>:<size>)
    return new File([storedFile], meta.name, { type: meta.type });
  } catch {
    // File doesn't exist or OPFS error
    return null;
  }
}

/**
 * Remove the saved PDF and its metadata.
 */
export async function clearPdf() {
  if (!isAvailable()) return;

  try {
    const root = await getOpfsRoot();
    await root.removeEntry(FILE_NAME);
  } catch {
    // File may not exist
  }
  localStorage.removeItem(META_KEY);
}
