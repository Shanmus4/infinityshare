import React from 'react';
import { buildFileTree } from '../utils/fileHelpers'; // Import the utility

// --- Recursive Rendering Component ---
// Receives ALL original FileList props + current node info
function RenderNode({ name, node, level, onDelete, onDownload, isSender, isDownloading }) {
  const indent = level * 20; // Indentation in pixels

  // --- AGGRESSIVE DEBUGGING ---
  console.log(`[RenderNode ENTRY] level=${level}, name="${name}", type=${node?.type}, isSender=${isSender}, node=`, node);
  // --- END DEBUGGING ---

  if (node.type === 'folder') {
    // --- Render Folder ---
    // console.log(`[RenderNode FOLDER] Rendering folder: ${name}`); // Optional folder log
    return (
      <li style={{ marginLeft: indent, listStyle: 'none', marginBottom: '5px' }}>
        {/* Folder Icon and Name */}
        <span style={{ fontWeight: 'bold' }}>
           <span role="img" aria-label="folder" style={{ marginRight: '5px' }}>&#128193;</span>
           {name}
        </span>
        {/* Recursively render children */}
        <ul style={{ paddingLeft: '10px', marginTop: '5px', borderLeft: '1px dashed #ccc' }}>
          {Object.entries(node.children)
            .sort(([aName, aNode], [bName, bNode]) => {
              // Sort folders first, then alphabetically
              if (aNode.type === 'folder' && bNode.type !== 'folder') return -1;
              if (aNode.type !== 'folder' && bNode.type === 'folder') return 1;
              return aName.localeCompare(bName);
            })
            .map(([childName, childNode]) => (
              // *** CRUCIAL: Pass ALL props down recursively ***
              <RenderNode
                key={childName} // Key is unique within this folder level
                name={childName}
                node={childNode}
                level={level + 1}
                // Pass down the functions and state needed by file nodes
                onDelete={onDelete}
                onDownload={onDownload}
                isSender={isSender}
                isDownloading={isDownloading}
              />
            ))}
        </ul>
      </li>
    );
  } else if (node.type === 'file') {
    // --- Render File ---
    const file = node; // Rename for clarity, node IS the file object from buildFileTree

    // --- DEBUGGING FILE NODE ---
    console.log(`[RenderNode FILE] Rendering file: ${file?.name} (ID: ${file?.fileId})`, file);
    console.log(`  >> isSender: ${isSender}`);
    console.log(`  >> onDelete exists: ${!!onDelete}`);
    console.log(`  >> onDownload exists: ${!!onDownload}`);
    console.log(`  >> isDownloading exists: ${!!isDownloading}`);
    // --- END DEBUGGING ---

    // Basic check for essential file data
    if (!file || !file.fileId || !file.name) {
        console.error("[RenderNode FILE] Invalid file node data:", file);
        return <li style={{ marginLeft: indent, color: 'red' }}>[Error: Invalid File Data]</li>;
    }

    const displayName = file.name; // Use original name stored in the node
    const fileSize = file.size !== undefined ? file.size.toLocaleString() : 'N/A';

    // Determine download state (only relevant for receiver)
    let isCurrentlyDownloading = false;
    if (isSender === false && typeof isDownloading === 'function') {
       try {
           isCurrentlyDownloading = isDownloading(file.fileId);
           // console.log(`  >> isDownloading(${file.fileId}) result: ${isCurrentlyDownloading}`); // Optional log
       } catch (e) {
           console.error(`[RenderNode] Error calling isDownloading(${file.fileId}):`, e);
       }
    }

    // Button conditions
    const showDeleteButton = isSender === true && typeof onDelete === 'function';
    const showDownloadButton = isSender === false && typeof onDownload === 'function';

    // --- DEBUGGING BUTTON CONDITIONS ---
    // console.log(`  >> Show Delete Button? ${showDeleteButton}`);
    // console.log(`  >> Show Download Button? ${showDownloadButton}`);
    // --- END DEBUGGING ---


    return (
      <li
        key={file.fileId} // Use the unique fileId as the key
        style={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: 8,
          marginLeft: indent,
          listStyle: 'none',
          paddingBottom: 5,
          borderBottom: '1px solid #eee'
         }}
      >
        {/* File Icon, Name and Size */}
        <span style={{ flex: 1, wordBreak: 'break-all' }}>
          <span role="img" aria-label="file" style={{ marginRight: '5px' }}>&#128196;</span>
          {displayName} ({fileSize} bytes)
        </span>

        {/* Action Buttons */}
        {showDeleteButton && (
            <button style={{ marginLeft: 8, flexShrink: 0 }} onClick={() => onDelete(file.fileId)}>Delete</button>
        )}
        {showDownloadButton && (
            <button
              style={{ marginLeft: 8, flexShrink: 0 }}
              onClick={() => onDownload(file.fileId)}
              disabled={isCurrentlyDownloading}
            >
              {isCurrentlyDownloading ? 'Downloading…' : 'Download'}
            </button>
        )}
        {/* Render nothing if conditions not met */}

      </li>
    );
  }

  // Log unexpected node types
  console.warn("[RenderNode] Encountered unexpected node type or structure:", node);
  return <li style={{ marginLeft: indent, color: 'orange' }}>[Warning: Unknown Item Type]</li>;
}


// --- Main FileList Component ---
function FileList({ files, onDelete, onDownload, isSender, isDownloading }) {
  // Basic validation
  if (!Array.isArray(files)) {
    console.error("[FileList] Error: 'files' prop is not an array.", files);
    return <div style={{ color: 'red', fontWeight: 'bold' }}>[Error: Invalid file data received]</div>;
  }

  if (files.length === 0) {
    return <div style={{ color: '#aaa', fontStyle: 'italic' }}>[No files added yet]</div>;
  }

  // Build the tree structure from the flat list
  const fileTree = buildFileTree(files);

  // --- DEBUGGING ---
  // console.log("[FileList Render] Built Tree:", fileTree);
  // console.log(`  >> isSender=${isSender}`);
  // console.log(`  >> onDelete exists? ${!!onDelete}`);
  // console.log(`  >> onDownload exists? ${!!onDownload}`);
  // console.log(`  >> isDownloading exists? ${!!isDownloading}`);
  // --- END DEBUGGING ---


  return (
    <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
      {Object.entries(fileTree)
         .sort(([aName, aNode], [bName, bNode]) => {
            // Sort folders first, then alphabetically at the root level
            if (aNode.type === 'folder' && bNode.type !== 'folder') return -1;
            if (aNode.type !== 'folder' && bNode.type === 'folder') return 1;
            return aName.localeCompare(bName);
          })
        .map(([name, node]) => (
          // Start rendering the tree from the root level (level 0)
          // Pass ALL original props needed by RenderNode down
          <RenderNode
            key={name} // Use name as key at the root level
            name={name}
            node={node}
            level={0}
            onDelete={onDelete}
            onDownload={onDownload}
            isSender={isSender}
            isDownloading={isDownloading}
          />
      ))}
    </ul>
  );
}

export default FileList;