export function makeFileId() {
  return Math.random().toString(36).substr(2, 9);
}

/**
 * Converts a flat list of file objects (with optional 'path' property)
 * into a nested tree structure representing folders and files.
 *
 * @param {Array<Object>} files - Flat array of file objects.
 *                                Each object should have at least 'name' and 'fileId'.
 *                                If 'path' exists (e.g., "Folder/Sub/file.txt"), it's used.
 * @returns {Object} A nested object representing the file tree.
 *                   Folders have { type: 'folder', children: {...}, fullPath: '...' }.
 *                   Files have { type: 'file', ...originalFileObject }.
 */
export function buildFileTree(files) {
  const tree = {};

  if (!Array.isArray(files)) {
    console.error("buildFileTree received non-array input:", files);
    return tree; // Return empty tree on invalid input
  }

  files.forEach(file => {
    // Basic validation for the file object itself
    if (!file || typeof file !== 'object' || !file.fileId) {
        console.warn("buildFileTree skipping invalid file object:", file);
        return; // Skip this invalid entry
    }

    // Use file.path if available and is a non-empty string, otherwise fallback to file.name
    const pathString = (typeof file.path === 'string' && file.path.trim()) ? file.path : file.name;
    if (!pathString) {
        console.warn("buildFileTree skipping file object with no valid path or name:", file);
        return; // Skip if no path or name
    }

    // Standardize to forward slashes FIRST, remove leading/trailing slashes
    const standardizedPathString = pathString.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    // Split by / , filter out empty parts (e.g., from double slashes)
    const pathParts = standardizedPathString.split('/').filter(part => part.length > 0);

    let currentLevel = tree;
    let currentPathSegments = []; // Keep track of path segments for folder fullPath

    pathParts.forEach((part, index) => {
      currentPathSegments.push(part); // Add current part to segments list
      const folderFullPath = currentPathSegments.join('/'); // Construct full path using ONLY forward slashes
      const isLastPart = index === pathParts.length - 1;

      if (isLastPart) {
        // --- Last part: should be the file ---
        if (!currentLevel[part]) {
          // Does not exist yet, create file node with CORRECT type
          currentLevel[part] = { ...file, type: 'file' }; // Ensure type is 'file'
        } else if (currentLevel[part].type === 'folder') {
          // Conflict: Folder already exists with this name
          console.warn(`buildFileTree: File path "${pathString}" conflicts with existing folder "${part}". File not added to tree.`);
          // Option: Could add it with a modified name like file[conflict].txt? For now, just warn and skip.
        } else {
          // Conflict: File already exists with this name (e.g., duplicate entry in input)
          console.warn(`buildFileTree: Duplicate file path detected or name conflict "${pathString}". Overwriting previous entry.`);
          currentLevel[part] = { ...file, type: 'file' }; // Overwrite with CORRECT type
        }
      } else {
        // --- Intermediate part: should be a folder ---
        // folderFullPath is already calculated above

        if (!currentLevel[part]) {
          // Folder does not exist, create it and store its full path
          currentLevel[part] = { type: 'folder', children: {}, fullPath: folderFullPath };
          currentLevel = currentLevel[part].children; // Move into the new folder's children
        } else if (currentLevel[part].type === 'folder') {
          // Folder already exists, move into its children
          // Ensure fullPath is set if it wasn't somehow (e.g., created implicitly earlier)
          if (!currentLevel[part].fullPath) {
              currentLevel[part].fullPath = folderFullPath;
          }
          currentLevel = currentLevel[part].children;
        } else {
          // Conflict: A file exists with the name needed for a folder path segment
          console.warn(`buildFileTree: Folder path segment "${part}" in "${pathString}" conflicts with existing file. Skipping this file.`);
          // Remove the last segment as we are stopping processing for this file path
          currentPathSegments.pop();
          return; // Stop processing this file path due to conflict
        }
      }
    });
  });

  return tree;
}