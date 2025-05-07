import React from 'react'; // Removed { useCallback } as it's not used here with useMemo/useEffect
import Dropzone from 'react-dropzone';

// Accept children and an optional className prop
function DropzoneArea({ onDrop, children, className: additionalClassName = '' }) {
  return (
    <Dropzone
      onDrop={onDrop}
      multiple
      onDragEnter={(e) => {
        // Add class when dragging over
        if (e.target && e.target.classList) { // Check if e.target and classList exist
          const dropzoneDiv = e.target.closest('.dropzone'); // Find the dropzone parent
          if (dropzoneDiv) dropzoneDiv.classList.add('drag-over');
        }
      }}
      onDragLeave={(e) => {
        // Remove class when dragging leaves
         if (e.target && e.target.classList) {
          const dropzoneDiv = e.target.closest('.dropzone');
          if (dropzoneDiv) dropzoneDiv.classList.remove('drag-over');
        }
      }}
      onDropAccepted={(acceptedFiles, event) => {
        // Ensure class is removed after drop
        if (event.target && event.target.classList) {
            const dropzoneDiv = event.target.closest('.dropzone');
            if (dropzoneDiv) dropzoneDiv.classList.remove('drag-over');
        }
      }}
       onDropRejected={(fileRejections, event) => {
        // Ensure class is removed after rejected drop
        if (event.target && event.target.classList) {
            const dropzoneDiv = event.target.closest('.dropzone');
            if (dropzoneDiv) dropzoneDiv.classList.remove('drag-over');
        }
      }}
    >
      {({ getRootProps, getInputProps, isDragActive }) => (
        // Merge the base "dropzone" class, the drag-over class, and any additional class passed in
        <div {...getRootProps()} className={`dropzone ${isDragActive ? 'drag-over' : ''} ${additionalClassName}`}>
          <input {...getInputProps()} />
          {/* Render children if provided, otherwise default text (though children are now expected) */}
          {children ? children : <p>Drag 'n' drop some files here, or click to select files</p>}
        </div>
      )}
    </Dropzone>
  );
}

export default DropzoneArea;