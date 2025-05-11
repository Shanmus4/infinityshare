import React from 'react';
import ReactDOM from 'react-dom';

const modalRoot = document.getElementById('modal-root');

function Modal({ show, onClose, title, children }) {
  if (!show) {
    return null;
  }

  const modalContent = (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="modal-close-button" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="modal-body">
          {children}
        </div>
      </div>
    </div>
  );

  if (modalRoot) {
    return ReactDOM.createPortal(modalContent, modalRoot);
  } else {
    // Fallback if modal-root is not found, though it should be.
    // This will render it in place, and the scaling issue might persist.
    console.warn("Modal root element not found. Rendering modal in place.");
    return modalContent;
  }
}

export default Modal;
