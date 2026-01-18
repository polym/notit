export class FloatingMenu {
  private host: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private onColorSelect: (color: string, comment?: string) => void;

  constructor(onColorSelect: (color: string, comment?: string) => void) {
    this.onColorSelect = onColorSelect;
  }

  public show(x: number, y: number) {
    this.remove(); // Ensure only one menu exists

    console.log('[NoteIt] FloatingMenu.show() called at:', x, y);

    this.host = document.createElement('div');
    this.host.setAttribute('data-noteit-menu', 'true');
    this.host.style.position = 'absolute';
    this.host.style.left = `${x}px`;
    this.host.style.top = `${y}px`;
    this.host.style.zIndex = '2147483647'; // Max z-index
    this.host.style.pointerEvents = 'auto';

    this.shadowRoot = this.host.attachShadow({ mode: 'closed' });
    
    const style = document.createElement('style');
    style.textContent = `
      .menu {
        background: white;
        border-radius: 4px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
        padding: 4px;
        display: flex;
        gap: 4px;
      }
      .color-btn {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid #ddd;
        cursor: pointer;
        transition: transform 0.1s;
      }
      .color-btn:hover {
        transform: scale(1.1);
      }
      .note-btn {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 1px solid #ddd;
        background: #f5f5f5;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        transition: transform 0.1s;
      }
      .note-btn:hover {
        transform: scale(1.1);
        background: #e0e0e0;
      }
      .input-container {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px;
        min-width: 200px;
      }
      .input-textarea {
        width: 100%;
        min-height: 60px;
        border: 1px solid #ddd;
        border-radius: 4px;
        padding: 4px;
        font-family: system-ui;
        font-size: 12px;
        resize: vertical;
      }
      .input-actions {
        display: flex;
        gap: 4px;
        justify-content: flex-end;
      }
      .btn {
        padding: 4px 12px;
        border-radius: 4px;
        border: 1px solid #ddd;
        cursor: pointer;
        font-size: 12px;
        background: white;
      }
      .btn-save {
        background: #4caf50;
        color: white;
        border-color: #4caf50;
      }
      .btn-save:hover {
        background: #45a049;
      }
      .btn-cancel:hover {
        background: #f0f0f0;
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

    const textarea = document.createElement('textarea');
    textarea.className = 'input-textarea';
    textarea.placeholder = 'Enter your note...';
    container.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'input-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-save';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const comment = textarea.value.trim();
      if (comment) {
        this.onColorSelect('#ffeb3b', comment); // Default yellow for comments
        this.remove();
      }
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.renderColorMode();
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

  public remove() {
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadowRoot = null;
    }
  }
}
