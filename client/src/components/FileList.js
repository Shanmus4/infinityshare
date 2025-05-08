import React, { useState } from 'react';
import { buildFileTree } from '../utils/fileHelpers';

// --- Icons ---
const FolderIcon = () => (
  <svg className="folder-icon-svg" xmlns="http://www.w3.org/2000/svg" width="24" height="25" viewBox="0 0 24 25" fill="none">
    <path d="M4 20.5C3.45 20.5 2.97933 20.3043 2.588 19.913C2.19667 19.5217 2.00067 19.0507 2 18.5V6.5C2 5.95 2.196 5.47933 2.588 5.088C2.98 4.69667 3.45067 4.50067 4 4.5H10L12 6.5H20C20.55 6.5 21.021 6.696 21.413 7.088C21.805 7.48 22.0007 7.95067 22 8.5V18.5C22 19.05 21.8043 19.521 21.413 19.913C21.0217 20.305 20.5507 20.5007 20 20.5H4Z" fill="#6F5700"/> {/* Using Secondary Yellow for folder */}
  </svg>
);

const ArrowIcon = () => (
   <svg xmlns="http://www.w3.org/2000/svg" width="24" height="25" viewBox="0 0 24 25" fill="none">
     <path d="M9.5 6.5L15.5 12.5L9.5 18.5" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
   </svg>
);

const DeleteIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="25" viewBox="0 0 24 25" fill="none">
    <path d="M7 21.5C6.45 21.5 5.97933 21.3043 5.588 20.913C5.19667 20.5217 5.00067 20.0507 5 19.5V6.5H4V4.5H9V3.5H15V4.5H20V6.5H19V19.5C19 20.05 18.8043 20.521 18.413 20.913C18.0217 21.305 17.5507 21.5007 17 21.5H7ZM17 6.5H7V19.5H17V6.5ZM9 17.5H11V8.5H9V17.5ZM13 17.5H15V8.5H13V17.5Z" fill="black"/>
  </svg>
);

// --- Specific File Type Icons ---
const ImageIcon = () => (
  <svg className="file-icon-svg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#24A094"> {/* Changed to fill */}
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" stroke="#24A094" strokeWidth="1" fillOpacity="0.1"/> {/* Light fill for rect body */}
    <circle cx="8.5" cy="8.5" r="1.5" fill="#24A094"/>
    <polyline points="21 15 16 10 5 21" stroke="#24A094" strokeWidth="1.5" fill="none"/>
  </svg>
);

const VideoIcon = () => (
  <svg className="file-icon-svg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#24A094"> {/* Changed to fill */}
    <polygon points="23 7 16 12 23 17 23 7" fill="#24A094"/>
    <rect x="1" y="5" width="15" height="14" rx="2" ry="2" stroke="#24A094" strokeWidth="1" fillOpacity="0.1"/> {/* Light fill for rect body */}
  </svg>
);

const DocumentIcon = () => ( // Generic document/text/pdf
  <svg className="file-icon-svg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#24A094" strokeWidth="1.5"> {/* Adjusted stroke for lines */}
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="#24A094" fillOpacity="0.1" stroke="#24A094" strokeWidth="1"></path> {/* Main body with light fill */}
    <polyline points="14 2 14 8 20 8" stroke="#24A094" strokeWidth="1"></polyline>
    <line x1="16" y1="13" x2="8" y2="13" stroke="#24A094" strokeWidth="1.5"></line>
    <line x1="16" y1="17" x2="8" y2="17" stroke="#24A094" strokeWidth="1.5"></line>
    <polyline points="10 9 9 9 8 9" stroke="#24A094" strokeWidth="1.5"></polyline>
  </svg>
);

const GenericFileIcon = () => ( // Fallback
    <svg className="file-icon-svg" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2ZM18 20H6V4H13V9H18V20Z" fill="#24A094"/> {/* Using Primary Green for file */}
    </svg>
);

// --- File Icon Dispatcher ---
const FileIcon = ({ fileType, fileName }) => {
  const extension = fileName?.split('.').pop()?.toLowerCase();

  if (fileType?.startsWith('image/')) return <ImageIcon />;
  if (fileType?.startsWith('video/')) return <VideoIcon />;
  if (fileType === 'application/pdf' || extension === 'pdf') return <DocumentIcon />;
  if (fileType?.startsWith('text/') || ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) return <DocumentIcon />;
  
  return <GenericFileIcon />;
};

// --- Helper function to format file size ---
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  if (isNaN(parseFloat(bytes)) || !isFinite(bytes)) return 'N/A';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  if (i >= sizes.length) return (bytes / Math.pow(k, sizes.length -1 )).toFixed(1) + ' ' + sizes[sizes.length -1];

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

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
  const [isExpanded, setIsExpanded] = useState(false);
  const indent = level * 16; // Base indentation in pixels

  const handleToggle = (e) => {
    e.stopPropagation(); // Prevent event bubbling if nested
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

    const isCurrentlyZippingThisFolder = isZipping && zippingFolderPath === fullPath;
    const isDownloadDisabled = isZipping && !isCurrentlyZippingThisFolder;

    return (
      <div className="structure"> {/* Each folder/file gets its own structure container */}
        <div className="level-div" style={level > 0 ? { paddingLeft: 16 + indent } : {}}> {/* Folders: base 16px + indent for level > 0 */}
          <div className="arrow-folder-div" onClick={handleToggle} title={isExpanded ? 'Collapse' : 'Expand'}>
            <span className={`folder-arrow-icon ${isExpanded ? 'expanded' : ''} ${!hasChildren ? 'placeholder' : ''}`}>
              <ArrowIcon />
            </span>
            <div className="folder-icon-name-div">
              <FolderIcon />
              <span className="folder-name-text">{name}</span>
            </div>
          </div>
          {showDeleteButton && (
            <button
              className="level-delete-button"
              onClick={(e) => { e.stopPropagation(); onDeleteFolder(fullPath); }}
              title={`Delete folder "${name}" and all its contents`}
            >
              <DeleteIcon />
            </button>
          )}
          {showDownloadButton && (
             <button
               className="file-list-button" // Keep specific button class if needed
               onClick={(e) => { e.stopPropagation(); onDownloadFolder(fullPath); }}
               title={`Download folder "${name}" as zip`}
               disabled={isDownloadDisabled}
             >
               {isCurrentlyZippingThisFolder ? `Zipping...` : 'Download'}
             </button>
           )}
        </div>
        {/* Inline Progress Display for this folder */}
        {isCurrentlyZippingThisFolder && (
          <div className="folder-progress-container" style={{ marginLeft: indent + 24 }}> {/* Indent progress */}
            <div className="folder-progress-bar-bg">
              <div className="folder-progress-bar-fg" style={{ width: `${zipProgress}%` }}>
                {zipProgress.toFixed(1)}%
              </div>
            </div>
            <div className="folder-progress-stats">
              <span>Speed: {formatSpeed(downloadSpeed)}</span>
              <span>ETR: {formatEtr(etr)}</span>
            </div>
            <div className="folder-progress-wait-text">
               (Please wait, the download will start automatically when zipping is complete)
            </div>
          </div>
        )}
        {/* Render Children */}
        {hasChildren && isExpanded && (
           <div className="folder-children-container"> {/* Optional: wrapper for children */}
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
                   level={level + 1} // Increase level for children
                   onDelete={onDelete}
                   onDownload={onDownload}
                   isSender={isSender}
                   isDownloading={isDownloading}
                   onDeleteFolder={onDeleteFolder}
                   onDownloadFolder={onDownloadFolder}
                   isZipping={isZipping}
                   zippingFolderPath={zippingFolderPath}
                   zipProgress={zipProgress}
                   downloadSpeed={downloadSpeed}
                   etr={etr}
                   formatSpeed={formatSpeed}
                   formatEtr={formatEtr}
                 />
               ))}
           </div>
        )}
      </div>
    );
  } else if (node.type === 'file') {
    // --- Render File ---
    const file = node;
    if (!file || !file.fileId || !file.name) {
        console.error("[RenderNode FILE] Invalid file node data:", file);
        return <div className="level-div file-list-error" style={{ paddingLeft: indent }}>[Error: Invalid File Data]</div>;
    }
    const displayName = file.name;
    const fileSize = formatFileSize(file.size); // Use the new formatting function
    let isCurrentlyDownloading = false;
    if (isSender === false && typeof isDownloading === 'function') {
       try { isCurrentlyDownloading = isDownloading(file.fileId); } catch (e) { console.error(`[RenderNode] Error calling isDownloading(${file.fileId}):`, e); }
    }
    const showDeleteButton = isSender === true && typeof onDelete === 'function';
    const showDownloadButton = isSender === false && typeof onDownload === 'function';

    // Apply file-level class and dynamic indentation
    const fileLevelClass = level > 0 ? 'file-level' : ''; // Apply only if nested
    // Calculate padding for files to match their parent folder's left padding
    const filePaddingValue = (level === 0) ? 16 : (16 + ((level - 1) * 16));
    const fileStyle = { paddingLeft: filePaddingValue, paddingRight: filePaddingValue };

    return (
      <div className="structure"> {/* Each file gets its own structure container */}
        <div className={`level-div ${fileLevelClass}`} style={fileStyle}>
           <div className="folder-icon-name-div" style={{ flexGrow: 1 }}> {/* Use same class for consistency */}
              <FileIcon fileType={file.type} fileName={displayName} />
              <span className="file-name-text">{displayName}</span>
              <span className="file-size">({fileSize})</span>
           </div>
           {showDeleteButton && (
             <button className="level-delete-button" onClick={() => onDelete(file.fileId)} title={`Delete file "${displayName}"`}>
               <DeleteIcon />
             </button>
           )}
           {showDownloadButton && (
             <button className="file-list-button" onClick={() => onDownload(file.fileId)} disabled={isCurrentlyDownloading}>
               {isCurrentlyDownloading ? 'Downloading…' : 'Download'}
             </button>
           )}
        </div>
      </div>
    );
  }

  return <div className="level-div" style={{ paddingLeft: indent, color: 'orange' }}>[Warning: Unknown Item Type]</div>;
}


// --- Main FileList Component ---
function FileList({
  files, onDelete, onDownload, isSender, isDownloading, onDeleteFolder, onDownloadFolder,
  // Add progress props
  isZipping, zippingFolderPath, zipProgress, downloadSpeed, etr, formatSpeed, formatEtr
}) {
  if (!Array.isArray(files)) {
    console.error("[FileList] Error: 'files' prop is not an array.", files);
    return <div className="file-list-error">[Error: Invalid file data received]</div>;
  }
  if (files.length === 0) {
    return <div className="file-list-empty-textfield">Drive Empty, please add files</div>;
  }
  const fileTree = buildFileTree(files);

  return (
    <div className="drive-contents-div"> {/* Main container */}
       <div className="subhead"> {/* Subhead for Drive Contents */}
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="33" viewBox="0 0 32 33" fill="black">
             <path d="M6.15467 22.3973H25.8467C26.0858 22.3973 26.2822 22.3204 26.436 22.1667C26.5898 22.0129 26.6667 21.8164 26.6667 21.5773V14.7053H5.33333V21.5773C5.33333 21.8164 5.41022 22.0129 5.564 22.1667C5.71778 22.3204 5.91467 22.3973 6.15467 22.3973ZM22.8173 19.8853C23.1871 19.8853 23.5022 19.7555 23.7627 19.496C24.024 19.2382 24.1547 18.9244 24.1547 18.5547C24.1547 18.1849 24.0253 17.8693 23.7667 17.608C23.5071 17.3484 23.1929 17.2187 22.824 17.2187C22.4542 17.2187 22.1387 17.3475 21.8773 17.6053C21.616 17.8631 21.4862 18.1773 21.488 18.548C21.4898 18.9187 21.6187 19.2342 21.8747 19.4947C22.1307 19.7551 22.4449 19.8862 22.8173 19.8853ZM28 13.372H26.1307L22.9 10.0387H9.1L5.86933 13.372H4L7.92533 9.34399C8.11911 9.13332 8.34933 8.97421 8.616 8.86666C8.88267 8.7591 9.16356 8.70532 9.45867 8.70532H22.5413C22.8364 8.70532 23.1173 8.7591 23.384 8.86666C23.6507 8.97421 23.8809 9.13332 24.0747 9.34399L28 13.372ZM6.15467 23.7307C5.56178 23.7307 5.05467 23.5195 4.63333 23.0973C4.212 22.6751 4.00089 22.1684 4 21.5773V13.372H28V21.5773C28 22.1693 27.7889 22.676 27.3667 23.0973C26.9444 23.5187 26.4378 23.7298 25.8467 23.7307H6.15467Z"/>
          </svg>
          <span className="subhead-text">Drive Content</span>
       </div>
       {/* Render the file/folder structure */}
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
    </div>
  );
}

export default FileList;