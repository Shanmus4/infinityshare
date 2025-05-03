import React from 'react';
import Dropzone from 'react-dropzone';

function DropzoneArea({ onDrop, text }) {
  return (
    <Dropzone onDrop={onDrop} multiple>
      {({ getRootProps, getInputProps }) => (
        <div {...getRootProps()} style={{ border: '2px dashed #ccc', padding: 40, cursor: 'pointer', marginBottom: 20 }}>
          <input {...getInputProps()} />
          <p>{text}</p>
        </div>
      )}
    </Dropzone>
  );
}

export default DropzoneArea; 