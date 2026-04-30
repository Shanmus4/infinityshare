import React from 'react';
import Dropzone from 'react-dropzone';

// ─── Custom directory traversal ────────────────────────────────────────────
// Bypasses react-dropzone's file-selector library which throws NotFoundError
// on large/deep directories. Handles readEntries in batches with error recovery.

async function readAllEntries(dirReader) {
  const allEntries = [];
  let batch;
  do {
    try {
      batch = await new Promise((resolve, reject) =>
        dirReader.readEntries(resolve, reject)
      );
    } catch (err) {
      console.warn('[readEntries] batch failed, stopping early:', err.message);
      break;
    }
    allEntries.push(...batch);
  } while (batch && batch.length > 0);
  return allEntries;
}

async function entryToFile(entry) {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      (err) => {
        console.warn('[entryToFile] skipping', entry.fullPath, err.message);
        resolve(null);
      }
    );
  });
}

async function traverseEntry(entry, relativePath) {
  const files = [];

  if (entry.isFile) {
    const file = await entryToFile(entry);
    if (file) {
      // Attach the relative path so folder structure is preserved
      const pathStr = relativePath ? relativePath + file.name : file.name;
      try {
        Object.defineProperty(file, 'path', { value: pathStr, writable: false, configurable: true });
      } catch (_) {
        // Some browsers don't allow redefining path — that's OK
      }
      files.push(file);
    }
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = await readAllEntries(reader);
    const childPath = relativePath + entry.name + '/';
    for (const child of entries) {
      const childFiles = await traverseEntry(child, childPath);
      files.push(...childFiles);
    }
  }

  return files;
}

async function getFilesFromEvent(event) {
  // Handle <input type="file"> selections
  if (event.target && event.target.files) {
    return Array.from(event.target.files);
  }

  // Handle drag-and-drop
  const dt = event.dataTransfer;
  if (!dt || !dt.items) return [];

  const items = Array.from(dt.items);
  const allFiles = [];

  for (const item of items) {
    // Use webkitGetAsEntry for full folder support
    const entry = item.webkitGetAsEntry
      ? item.webkitGetAsEntry()
      : null;

    if (entry) {
      try {
        const files = await traverseEntry(entry, '');
        allFiles.push(...files);
      } catch (err) {
        console.warn('[traverseEntry] failed for', entry.name, err.message);
        // Fallback: try getAsFile
        const file = item.getAsFile?.();
        if (file) allFiles.push(file);
      }
    } else {
      const file = item.getAsFile?.();
      if (file) allFiles.push(file);
    }
  }

  return allFiles;
}
// ─────────────────────────────────────────────────────────────────────────────

function DropzoneArea({ onDrop, children, className: additionalClassName = '' }) {
  return (
    <Dropzone
      onDrop={onDrop}
      multiple
      useFsAccessApi={false}
      getFilesFromEvent={getFilesFromEvent}
      onDragEnter={(e) => {
        if (e.target && e.target.classList) {
          const dz = e.target.closest('.dropzone');
          if (dz) dz.classList.add('drag-over');
        }
      }}
      onDragLeave={(e) => {
        if (e.target && e.target.classList) {
          const dz = e.target.closest('.dropzone');
          if (dz) dz.classList.remove('drag-over');
        }
      }}
      onDropAccepted={(acceptedFiles, event) => {
        if (event.target && event.target.classList) {
          const dz = event.target.closest('.dropzone');
          if (dz) dz.classList.remove('drag-over');
        }
      }}
      onDropRejected={(fileRejections, event) => {
        if (event.target && event.target.classList) {
          const dz = event.target.closest('.dropzone');
          if (dz) dz.classList.remove('drag-over');
        }
      }}
    >
      {({ getRootProps, getInputProps, isDragActive }) => (
        <div
          {...getRootProps()}
          className={`dropzone ${isDragActive ? 'drag-over' : ''} ${additionalClassName}`}
        >
          <input {...getInputProps()} />
          {children ? children : <p>Drag 'n' drop files here, or click to select</p>}
        </div>
      )}
    </Dropzone>
  );
}

export default DropzoneArea;