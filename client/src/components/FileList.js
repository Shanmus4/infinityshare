import React, { useState } from 'react';
import { buildFileTree } from '../utils/fileHelpers';

// --- Recursive Rendering Component ---
function RenderNode({
  name,
  node,
  level,
  onDelete,
  onDownload,
  isSender,
  isDownloading,
  onDeleteFolder,
  onDownloadFolder,
  // Props for inline progress
  isZipping,
  zippingFolderPath,
  zipProgress,
  downloadSpeed,
  etr,
  formatSpeed,
  formatEtr
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
    const fullPath = node.fullPath;
    const showDeleteButton = isSender === true && typeof onDeleteFolder === 'function' && fullPath;
    const showDownloadButton = isSender === false && typeof onDownloadFolder === 'function' && fullPath;

    // Check if this specific folder is the one currently being zipped
    const isCurrentlyZippingThisFolder = isZipping && zippingFolderPath === fullPath;
    // Disable download button if *any* zip operation is in progress, unless it's this folder
    const isDownloadDisabled = isZipping && !isCurrentlyZippingThisFolder;

    return (
      <li style={{ marginLeft: indent, listStyle: 'none', marginBottom: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '2px 0' }}>
          <div
            onClick={hasChildren ? handleToggle : undefined}
            style={{ cursor: hasChildren ? 'pointer' : 'default', display: 'flex', alignItems: 'center', flexGrow: 1 }}
            title={hasChildren ? (isExpanded ? 'Click to collapse' : 'Click to expand') : 'Folder'}
          >
            <span style={{ width: '15px', display: 'inline-block', textAlign: 'center', marginRight: '3px' }}>
              {hasChildren ? (isExpanded ? '▼' : '▶') : <span style={{opacity: 0.3}}>▶</span>}
            </span>
            <span style={{ fontWeight: 'bold' }}>
               <span role="img" aria-label="folder" style={{ marginRight: '5px' }}>&#128193;</span>
               {name}
            </span>
          </div>
          {showDeleteButton && (
            <button
              style={{ marginLeft: 8, flexShrink: 0, fontSize: '0.8em', padding: '1px 4px' }}
              onClick={(e) => { e.stopPropagation(); onDeleteFolder(fullPath); }}
              title={`Delete folder "${name}" and all its contents`}
            >
              Delete
            </button>
          )}
          {showDownloadButton && (
             <button
               style={{ marginLeft: 8, flexShrink: 0, fontSize: '0.8em', padding: '1px 4px' }}
               onClick={(e) => { e.stopPropagation(); onDownloadFolder(fullPath); }}
               title={`Download folder "${name}" as zip`}
               disabled={isDownloadDisabled} // Disable if another zip is happening
             >
               {isCurrentlyZippingThisFolder ? `Zipping...` : 'Download'}
             </button>
           )}
        </div>
        {/* Inline Progress Display for this folder */}
        {isCurrentlyZippingThisFolder && (
          <div style={{ marginLeft: '15px', padding: '5px', border: '1px solid #eee', marginTop: '3px', fontSize: '0.9em' }}>
            {/* Progress Bar */}
            <div style={{ width: '100%', backgroundColor: '#ddd', height: '15px', marginBottom: '3px' }}>
              <div style={{
                width: `${zipProgress}%`,
                backgroundColor: '#4CAF50',
                height: '100%',
                textAlign: 'center',
                lineHeight: '15px',
                color: 'white',
                fontSize: '0.8em'
              }}>
                {zipProgress.toFixed(1)}%
              </div>
            </div>
            {/* Speed and ETR */}
            <div style={{ fontSize: '0.9em', color: '#555' }}>
              <span>Speed: {formatSpeed(downloadSpeed)}</span>
              <span style={{ marginLeft: '1em' }}>ETR: {formatEtr(etr)}</span>
            </div>
            <div style={{ fontSize: '0.8em', color: '#888', marginTop: '3px' }}>
               (Please wait, the download will start automatically when zipping is complete)
            </div>
          </div>
        )}
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
                  onDeleteFolder={onDeleteFolder}
                  onDownloadFolder={onDownloadFolder}
                  // Pass progress props down
                  isZipping={isZipping}
                  zippingFolderPath={zippingFolderPath}
                  zipProgress={zipProgress}
                  downloadSpeed={downloadSpeed}
                  etr={etr}
                  formatSpeed={formatSpeed}
                  formatEtr={formatEtr}
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

  // console.warn("[RenderNode] Encountered unexpected node type or structure:", node); // Keep this warning?
  return <li style={{ marginLeft: indent, color: 'orange' }}>[Warning: Unknown Item Type]</li>;
}


// --- Main FileList Component ---
function FileList({
  files, onDelete, onDownload, isSender, isDownloading, onDeleteFolder, onDownloadFolder,
  // Add progress props
  isZipping, zippingFolderPath, zipProgress, downloadSpeed, etr, formatSpeed, formatEtr
}) {
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
            onDeleteFolder={onDeleteFolder}
            onDownloadFolder={onDownloadFolder}
            // Pass progress props down
            isZipping={isZipping}
            zippingFolderPath={zippingFolderPath}
            zipProgress={zipProgress}
            downloadSpeed={downloadSpeed}
            etr={etr}
            formatSpeed={formatSpeed}
            formatEtr={formatEtr}
          />
      ))}
    </ul>
  );
}

export default FileList;