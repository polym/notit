export class FloatingMenu {
  private host: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private onColorSelect: (color: string, comment?: string) => void;
  private onClose: (() => void) | null = null;
  private currentEditElement: HTMLElement | null = null;
  private onUpdate: ((element: HTMLElement, color: string, comment?: string) => void) | null = null;

  constructor(onColorSelect: (color: string, comment?: string) => void, onClose?: () => void) {
    this.onColorSelect = onColorSelect;
    this.onClose = onClose || null;
  }

  public show(x: number, y: number) {
    this.remove(); // Ensure only one menu exists

    console.log('[NoteIt] FloatingMenu.show() called at:', x, y);

    this.host = document.createElement('div');
    this.host.setAttribute('data-noteit-menu', 'true');
    this.host.style.position = 'fixed'; // Use fixed positioning so it stays in viewport
    this.host.style.left = `${x}px`;
    this.host.style.top = `${y}px`;
    this.host.style.zIndex = '2147483647'; // Max z-index
    this.host.style.pointerEvents = 'auto';

    this.shadowRoot = this.host.attachShadow({ mode: 'closed' });
    
    const style = document.createElement('style');
    style.textContent = `
      .menu {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
        padding: 6px;
        display: flex;
        gap: 6px;
      }
      .color-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.9);
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .color-btn:hover {
        transform: scale(1.15);
        border-color: rgba(0, 0, 0, 0.3);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }
      .color-btn:active {
        transform: scale(1.05);
      }
      .note-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid rgba(0, 0, 0, 0.15);
        background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .note-btn:hover {
        transform: scale(1.15);
        border-color: #4caf50;
        box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
      }
      .note-btn:active {
        transform: scale(1.05);
      }
      .close-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid rgba(0, 0, 0, 0.15);
        background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        color: #c62828;
        font-weight: bold;
        line-height: 1;
      }
      .close-btn:hover {
        transform: scale(1.15);
        border-color: #c62828;
        box-shadow: 0 4px 12px rgba(198, 40, 40, 0.4);
      }
      .close-btn:active {
        transform: scale(1.05);
      }
      .input-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px;
        min-width: 280px;
        max-width: 320px;
        background: rgba(255, 255, 255, 0.98);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
        box-sizing: border-box;
      }
      .input-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        color: #333;
        margin-bottom: 4px;
      }
      .input-header-icon {
        font-size: 16px;
      }
      .input-textarea {
        width: 100%;
        min-height: 80px;
        max-height: 200px;
        border: 2px solid rgba(0, 0, 0, 0.12);
        border-radius: 6px;
        padding: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        resize: vertical;
        transition: all 0.2s ease;
        outline: none;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.05);
        box-sizing: border-box;
      }
      .input-textarea:focus {
        border-color: #4caf50;
        background: rgba(255, 255, 255, 1);
        box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.15), inset 0 1px 3px rgba(0, 0, 0, 0.05);
      }
      .input-textarea::placeholder {
        color: #999;
      }
      .input-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .btn {
        padding: 8px 16px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      }
      .btn-save {
        background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
        color: white;
        box-shadow: 0 2px 8px rgba(76, 175, 80, 0.35);
      }
      .btn-save:hover {
        box-shadow: 0 4px 12px rgba(76, 175, 80, 0.45);
        transform: translateY(-1px);
      }
      .btn-save:active {
        transform: translateY(0);
        box-shadow: 0 1px 4px rgba(76, 175, 80, 0.35);
      }
      .btn-cancel {
        background: rgba(245, 245, 245, 0.9);
        color: #666;
        border: 1px solid rgba(0, 0, 0, 0.1);
      }
      .btn-cancel:hover {
        background: rgba(232, 232, 232, 0.95);
        color: #333;
        border-color: rgba(0, 0, 0, 0.15);
      }
      .btn-cancel:active {
        background: rgba(224, 224, 224, 1);
      }
    `;
    this.shadowRoot.appendChild(style);

    this.renderColorMode();
    document.body.appendChild(this.host);
  }

  private renderColorMode() {
    if (!this.shadowRoot) return;

    // Save style element reference before clearing
    const styleElement = this.shadowRoot.querySelector('style');

    const menu = document.createElement('div');
    menu.className = 'menu';

    const colors = ['#ffeb3b', '#a5d6a7', '#90caf9', '#ef9a9a'];
    colors.forEach((color) => {
      const btn = document.createElement('div');
      btn.className = 'color-btn';
      btn.style.backgroundColor = color;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onColorSelect(color);
        this.remove();
      });
      menu.appendChild(btn);
    });

    // Add Note button
    const noteBtn = document.createElement('div');
    noteBtn.className = 'note-btn';
    noteBtn.textContent = '📝';
    noteBtn.title = 'Add Note';
    noteBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.switchToInputMode();
    });
    menu.appendChild(noteBtn);

    // Add Close button
    const closeBtn = document.createElement('div');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onClose) {
        this.onClose();
      }
      this.remove();
    });
    menu.appendChild(closeBtn);

    // Clear and rebuild
    this.shadowRoot.innerHTML = '';
    if (styleElement) {
      this.shadowRoot.appendChild(styleElement);
    }
    this.shadowRoot.appendChild(menu);
  }

  private switchToInputMode() {
    if (!this.shadowRoot) return;

    // Save style element reference before clearing
    const styleElement = this.shadowRoot.querySelector('style');

    const container = document.createElement('div');
    container.className = 'input-container';

    // Add header with icon
    const header = document.createElement('div');
    header.className = 'input-header';
    const headerIcon = document.createElement('span');
    headerIcon.className = 'input-header-icon';
    headerIcon.textContent = '📝';
    const headerText = document.createElement('span');
    headerText.textContent = 'Add Note';
    const closeBtn = document.createElement('span');
    closeBtn.style.marginLeft = 'auto';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.color = '#c62828';
    closeBtn.style.fontSize = '20px';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.style.lineHeight = '1';
    closeBtn.style.transition = 'all 0.2s ease';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.transform = 'scale(1.2)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.transform = 'scale(1)';
    });
    closeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onClose) {
        this.onClose();
      }
      this.remove();
    });
    header.appendChild(headerIcon);
    header.appendChild(headerText);
    header.appendChild(closeBtn);
    container.appendChild(header);

    const textarea = document.createElement('textarea');
    textarea.className = 'input-textarea';
    textarea.placeholder = 'Write your thoughts here...';
    container.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'input-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.renderColorMode();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-save';
    saveBtn.textContent = 'Save Note';
    saveBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const comment = textarea.value.trim();
      if (comment) {
        this.onColorSelect('#e1bee7', comment); // Purple for comments with notes
        this.remove();
      }
    });

    // Support Enter key (with Ctrl/Cmd) to save
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const comment = textarea.value.trim();
        if (comment) {
          this.onColorSelect('#e1bee7', comment); // Purple for comments with notes
          this.remove();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.renderColorMode();
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    container.appendChild(actions);

    // Clear and rebuild
    this.shadowRoot.innerHTML = '';
    if (styleElement) {
      this.shadowRoot.appendChild(styleElement);
    }
    this.shadowRoot.appendChild(container);

    // Focus textarea
    setTimeout(() => textarea.focus(), 0);
  }

  public showEditMode(x: number, y: number, highlightElement: HTMLElement, onUpdate: (element: HTMLElement, color: string, comment?: string) => void) {
    this.remove();
    this.currentEditElement = highlightElement;
    this.onUpdate = onUpdate;

    console.log('[NoteIt] FloatingMenu.showEditMode() called');

    this.host = document.createElement('div');
    this.host.setAttribute('data-noteit-menu', 'true');
    this.host.style.position = 'fixed'; // Use fixed positioning so it stays in viewport
    this.host.style.left = `${x}px`;
    this.host.style.top = `${y}px`;
    this.host.style.zIndex = '2147483647';
    this.host.style.pointerEvents = 'auto';

    this.shadowRoot = this.host.attachShadow({ mode: 'closed' });
    
    const style = document.createElement('style');
    style.textContent = `
      .menu {
        background: rgba(255, 255, 255, 0.95);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
        padding: 6px;
        display: flex;
        gap: 6px;
      }
      .color-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.9);
        cursor: pointer;
        transition: all 0.2s ease;
        position: relative;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .color-btn:hover {
        transform: scale(1.15);
        border-color: rgba(0, 0, 0, 0.3);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }
      .note-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid rgba(0, 0, 0, 0.15);
        background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }
      .note-btn:hover {
        transform: scale(1.15);
        border-color: #4caf50;
        box-shadow: 0 4px 12px rgba(76, 175, 80, 0.4);
      }
      .close-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid rgba(0, 0, 0, 0.15);
        background: linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        transition: all 0.2s ease;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        color: #c62828;
        font-weight: bold;
        line-height: 1;
      }
      .close-btn:hover {
        transform: scale(1.15);
        border-color: #c62828;
        box-shadow: 0 4px 12px rgba(198, 40, 40, 0.4);
      }
      .close-btn:active {
        transform: scale(1.05);
      }
      .input-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 16px;
        min-width: 280px;
        max-width: 320px;
        background: rgba(255, 255, 255, 0.98);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
        box-sizing: border-box;
      }
      .input-header {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        color: #333;
        margin-bottom: 4px;
      }
      .input-textarea {
        width: 100%;
        min-height: 80px;
        max-height: 200px;
        border: 2px solid rgba(0, 0, 0, 0.12);
        border-radius: 6px;
        padding: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        resize: vertical;
        transition: all 0.2s ease;
        outline: none;
        background: rgba(255, 255, 255, 0.9);
        box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.05);
        box-sizing: border-box;
      }
      .input-textarea:focus {
        border-color: #4caf50;
        background: rgba(255, 255, 255, 1);
        box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.15), inset 0 1px 3px rgba(0, 0, 0, 0.05);
      }
      .input-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }
      .btn {
        padding: 8px 16px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      }
      .btn-save {
        background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
        color: white;
        box-shadow: 0 2px 8px rgba(76, 175, 80, 0.35);
      }
      .btn-save:hover {
        box-shadow: 0 4px 12px rgba(76, 175, 80, 0.45);
        transform: translateY(-1px);
      }
      .btn-cancel {
        background: rgba(245, 245, 245, 0.9);
        color: #666;
        border: 1px solid rgba(0, 0, 0, 0.1);
      }
      .btn-cancel:hover {
        background: rgba(232, 232, 232, 0.95);
        color: #333;
        border-color: rgba(0, 0, 0, 0.15);
      }
    `;
    this.shadowRoot.appendChild(style);

    this.renderEditColorMode();
    document.body.appendChild(this.host);
  }

  private renderEditColorMode() {
    if (!this.shadowRoot) return;

    const styleElement = this.shadowRoot.querySelector('style');
    const menu = document.createElement('div');
    menu.className = 'menu';

    const colors = ['#ffeb3b', '#a5d6a7', '#90caf9', '#ef9a9a'];
    colors.forEach((color) => {
      const btn = document.createElement('div');
      btn.className = 'color-btn';
      btn.style.backgroundColor = color;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.currentEditElement && this.onUpdate) {
          this.onUpdate(this.currentEditElement, color);
          this.remove();
        }
      });
      menu.appendChild(btn);
    });

    // Add Note button
    const noteBtn = document.createElement('div');
    noteBtn.className = 'note-btn';
    noteBtn.textContent = '📝';
    noteBtn.title = 'Edit Note';
    noteBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.switchToEditInputMode();
    });
    menu.appendChild(noteBtn);

    // Add Close button
    const closeBtn = document.createElement('div');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onClose) {
        this.onClose();
      }
      this.remove();
    });
    menu.appendChild(closeBtn);

    this.shadowRoot.innerHTML = '';
    if (styleElement) {
      this.shadowRoot.appendChild(styleElement);
    }
    this.shadowRoot.appendChild(menu);
  }

  private switchToEditInputMode() {
    if (!this.shadowRoot || !this.currentEditElement) return;

    const styleElement = this.shadowRoot.querySelector('style');
    const container = document.createElement('div');
    container.className = 'input-container';

    const header = document.createElement('div');
    header.className = 'input-header';
    const headerText = document.createElement('span');
    headerText.textContent = '📝 Edit Note';
    const closeBtn = document.createElement('span');
    closeBtn.style.marginLeft = 'auto';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.color = '#c62828';
    closeBtn.style.fontSize = '20px';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.style.lineHeight = '1';
    closeBtn.style.transition = 'all 0.2s ease';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close';
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.transform = 'scale(1.2)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.transform = 'scale(1)';
    });
    closeBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onClose) {
        this.onClose();
      }
      this.remove();
    });
    header.appendChild(headerText);
    header.appendChild(closeBtn);
    container.appendChild(header);

    // Get existing comment if any
    const existingTooltip = this.currentEditElement.querySelector('.noteit-comment-tooltip');
    const existingComment = existingTooltip ? existingTooltip.textContent || '' : '';

    const textarea = document.createElement('textarea');
    textarea.className = 'input-textarea';
    textarea.placeholder = 'Write your thoughts here...';
    textarea.value = existingComment;
    container.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'input-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.renderEditColorMode();
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-save';
    saveBtn.textContent = 'Save Note';
    saveBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const comment = textarea.value.trim();
      if (this.currentEditElement && this.onUpdate) {
        const currentColor = this.currentEditElement.style.backgroundColor || '#e1bee7';
        this.onUpdate(this.currentEditElement, currentColor, comment);
        this.remove();
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const comment = textarea.value.trim();
        if (this.currentEditElement && this.onUpdate) {
          const currentColor = this.currentEditElement.style.backgroundColor || '#e1bee7';
          this.onUpdate(this.currentEditElement, currentColor, comment);
          this.remove();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.renderEditColorMode();
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    container.appendChild(actions);

    this.shadowRoot.innerHTML = '';
    if (styleElement) {
      this.shadowRoot.appendChild(styleElement);
    }
    this.shadowRoot.appendChild(container);

    setTimeout(() => textarea.focus(), 0);
  }

  public remove() {
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadowRoot = null;
      this.currentEditElement = null;
      this.onUpdate = null;
    }
  }
}
