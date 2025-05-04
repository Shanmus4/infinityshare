import React, { useState } from 'react';
import { buildFileTree } from '../utils/fileHelpers';

// --- Recursive Rendering Component ---
// Receives ALL original FileList props + folder handlers + current node info
function RenderNode({
  name,
  node,
  level,
  onDelete,
  onDownload,
  isSender,
  isDownloading,
  onDeleteFolder,  // <-- New prop
  onDownloadFolder // <-- New prop
}) {
  const indent = level * 20;
  const [isExpanded, setIsExpanded] = useState(false);

  const handleToggle = () => {
    if (node.type === 'folder') {
      setIsExpanded(!isExpanded);
    }
  };

  if (node.type === 'folder') {
    // --- Render Folder ---
    const hasChildren = Object.keys(node.children).length > 0;
    const fullPath = node.fullPath; // Get the full path stored by buildFileTree

    // Determine button visibility/functionality
    const showDeleteButton = isSender === true && typeof onDeleteFolder === 'function' && fullPath;
    const showDownloadButton = isSender === false && typeof onDownloadFolder === 'function' && fullPath;

    return (
      <li style={{ marginLeft: indent, listStyle: 'none', marginBottom: '2px' }}>
        {/* Clickable Folder Row & Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '2px 0' }}>
          {/* Clickable Area for Expansion */}
          <div
            onClick={hasChildren ? handleToggle : undefined}
            style={{ cursor: hasChildren ? 'pointer' : 'default', display: 'flex', alignItems: 'center', flexGrow: 1 }}
            title={hasChildren ? (isExpanded ? 'Click to collapse' : 'Click to expand') : 'Folder'}
          >
            {/* Expansion Indicator */}
            <span style={{ width: '15px', display: 'inline-block', textAlign: 'center', marginRight: '3px' }}>
              {hasChildren ? (isExpanded ? '▼' : '▶') : <span style={{opacity: 0.3}}>▶</span> /* Dimmed indicator if no children */}
            </span>
            {/* Folder Icon and Name */}
            <span style={{ fontWeight: 'bold' }}>
               <span role="img" aria-label="folder" style={{ marginRight: '5px' }}>&#128193;</span>
               {name}
            </span>
          </div>

          {/* Folder Action Buttons */}
          {showDeleteButton && (
            <button
              style={{ marginLeft: 8, flexShrink: 0, fontSize: '0.8em', padding: '1px 4px' }}
              onClick={(e) => { e.stopPropagation(); onDeleteFolder(fullPath); }} // Prevent toggle on button click
              title={`Delete folder "${name}" and all its contents`}
            >
              Delete
            </button>
          )}
          {showDownloadButton && (
             <button
               style={{ marginLeft: 8, flexShrink: 0, fontSize: '0.8em', padding: '1px 4px' }}
               onClick={(e) => { e.stopPropagation(); onDownloadFolder(fullPath); }} // Prevent toggle on button click
               title={`Download folder "${name}" as zip`}
             >
               Download
             </button>
           )}
        </div>

        {/* Conditionally render children */}
        {hasChildren && isExpanded && (
          <ul style={{ paddingLeft: '10px', marginTop: '0px', borderLeft: '1px dashed #ccc' }}>
            {Object.entries(node.children)
              .sort(([aName, aNode], [bName, bNode]) => {
                if (aNode.type === 'folder' && bNode.type !== 'folder') return -1;
                if (aNode.type !== 'folder' && bNode.type === 'folder') return 1;
                return aName.localeCompare(bName);
              })
              .map(([childName, childNode]) => (
                // *** Pass ALL props down recursively, INCLUDING FOLDER HANDLERS ***
                <RenderNode
                  key={childName}
                  name={childName}
                  node={childNode}
                  level={level + 1}
                  onDelete={onDelete}
                  onDownload={onDownload}
                  isSender={isSender}
                  isDownloading={isDownloading}
                  onDeleteFolder={onDeleteFolder}   // <-- Pass down
                  onDownloadFolder={onDownloadFolder} // <-- Pass down
                />
              ))}
          </ul>
        )}
      </li>
    );
  } else if (node.type === 'file') {
    // --- Render File (Logic largely unchanged) ---
    const file = node;
    if (!file || !file.fileId || !file.name) {
        console.error("[RenderNode FILE] Invalid file node data:", file);
        return <li style={{ marginLeft: indent, color: 'red' }}>[Error: Invalid File Data]</li>;
    }
    const displayName = file.name;
    const fileSize = file.size !== undefined ? file.size.toLocaleString() : 'N/A';
    let isCurrentlyDownloading = false;
    if (isSender === false && typeof isDownloading === 'function') {
       try { isCurrentlyDownloading = isDownloading(file.fileId); } catch (e) { console.error(`[RenderNode] Error calling isDownloading(${file.fileId}):`, e); }
    }
    const showDeleteButton = isSender === true && typeof onDelete === 'function';
    const showDownloadButton = isSender === false && typeof onDownload === 'function';

    return (
      <li
        key={file.fileId}
        style={{ display: 'flex', alignItems: 'center', marginBottom: 8, marginLeft: indent + 15, listStyle: 'none', paddingBottom: 5, borderBottom: '1px solid #eee' }}
      >
        <span style={{ flex: 1, wordBreak: 'break-all' }}>
          <span role="img" aria-label="file" style={{ marginRight: '5px' }}>&#128196;</span>
          {displayName} ({fileSize} bytes)
        </span>
        {showDeleteButton && (<button style={{ marginLeft: 8, flexShrink: 0 }} onClick={() => onDelete(file.fileId)}>Delete</button>)}
        {showDownloadButton && (<button style={{ marginLeft: 8, flexShrink: 0 }} onClick={() => onDownload(file.fileId)} disabled={isCurrentlyDownloading}>{isCurrentlyDownloading ? 'Downloading…' : 'Download'}</button>)}
      </li>
    );
  }

  console.warn("[RenderNode] Encountered unexpected node type or structure:", node);
  return <li style={{ marginLeft: indent, color: 'orange' }}>[Warning: Unknown Item Type]</li>;
}


// --- Main FileList Component ---
// Now receives onDeleteFolder and onDownloadFolder
function FileList({ files, onDelete, onDownload, isSender, isDownloading, onDeleteFolder, onDownloadFolder }) {
  if (!Array.isArray(files)) {
    console.error("[FileList] Error: 'files' prop is not an array.", files);
    return <div style={{ color: 'red', fontWeight: 'bold' }}>[Error: Invalid file data received]</div>;
  }
  if (files.length === 0) {
    return <div style={{ color: '#aaa', fontStyle: 'italic' }}>[No files added yet]</div>;
  }
  const fileTree = buildFileTree(files);

  return (
    <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
      {Object.entries(fileTree)
         .sort(([aName, aNode], [bName, bNode]) => {
            if (aNode.type === 'folder' && bNode.type !== 'folder') return -1;
            if (aNode.type !== 'folder' && bNode.type === 'folder') return 1;
            return aName.localeCompare(bName);
          })
        .map(([name, node]) => (
          // Pass ALL props, including folder handlers, to the top-level RenderNode
          <RenderNode
            key={name}
            name={name}
            node={node}
            level={0}
            onDelete={onDelete}
            onDownload={onDownload}
            isSender={isSender}
            isDownloading={isDownloading}
            onDeleteFolder={onDeleteFolder}   // <-- Pass down
            onDownloadFolder={onDownloadFolder} // <-- Pass down
          />
      ))}
    </ul>
  );
}

export default FileList;