import React, { useState } from 'react'; // Import useState
import { buildFileTree } from '../utils/fileHelpers';

// --- Recursive Rendering Component ---
function RenderNode({ name, node, level, onDelete, onDownload, isSender, isDownloading }) {
  const indent = level * 20;
  const [isExpanded, setIsExpanded] = useState(false); // State for folder expansion

  // Toggle function for folders
  const handleToggle = () => {
    if (node.type === 'folder') {
      setIsExpanded(!isExpanded);
    }
  };

  if (node.type === 'folder') {
    // --- Render Folder ---
    const hasChildren = Object.keys(node.children).length > 0; // Check if folder has content to expand

    return (
      <li style={{ marginLeft: indent, listStyle: 'none', marginBottom: '2px' }}>
        {/* Clickable Folder Row */}
        <div
          onClick={hasChildren ? handleToggle : undefined} // Only allow toggle if it has children
          style={{
            cursor: hasChildren ? 'pointer' : 'default', // Change cursor only if clickable
            display: 'flex',
            alignItems: 'center',
            padding: '2px 0' // Add some padding
          }}
          title={hasChildren ? (isExpanded ? 'Click to collapse' : 'Click to expand') : 'Empty folder'}
        >
          {/* Expansion Indicator */}
          <span style={{ width: '15px', display: 'inline-block', textAlign: 'center', marginRight: '3px' }}>
            {hasChildren ? (isExpanded ? '▼' : '▶') : '' /* Show indicator only if children exist */}
          </span>
          {/* Folder Icon and Name */}
          <span style={{ fontWeight: 'bold' }}>
             <span role="img" aria-label="folder" style={{ marginRight: '5px' }}>&#128193;</span>
             {name}
          </span>
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
                <RenderNode
                  key={childName}
                  name={childName}
                  node={childNode}
                  level={level + 1}
                  onDelete={onDelete}
                  onDownload={onDownload}
                  isSender={isSender}
                  isDownloading={isDownloading}
                />
              ))}
          </ul>
        )}
      </li>
    );
  } else if (node.type === 'file') {
    // --- Render File ---
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
        style={{ display: 'flex', alignItems: 'center', marginBottom: 8, marginLeft: indent + 15, listStyle: 'none', paddingBottom: 5, borderBottom: '1px solid #eee' }} // Indent files slightly more
      >
        {/* File Icon, Name and Size */}
        <span style={{ flex: 1, wordBreak: 'break-all' }}>
          <span role="img" aria-label="file" style={{ marginRight: '5px' }}>&#128196;</span>
          {displayName} ({fileSize} bytes)
        </span>
        {/* Action Buttons */}
        {showDeleteButton && (<button style={{ marginLeft: 8, flexShrink: 0 }} onClick={() => onDelete(file.fileId)}>Delete</button>)}
        {showDownloadButton && (<button style={{ marginLeft: 8, flexShrink: 0 }} onClick={() => onDownload(file.fileId)} disabled={isCurrentlyDownloading}>{isCurrentlyDownloading ? 'Downloading…' : 'Download'}</button>)}
      </li>
    );
  }

  console.warn("[RenderNode] Encountered unexpected node type or structure:", node);
  return <li style={{ marginLeft: indent, color: 'orange' }}>[Warning: Unknown Item Type]</li>;
}


// --- Main FileList Component ---
function FileList({ files, onDelete, onDownload, isSender, isDownloading }) {
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
          <RenderNode
            key={name}
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