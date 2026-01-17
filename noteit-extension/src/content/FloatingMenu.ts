export class FloatingMenu {
  private host: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;
  private onColorSelect: (color: string) => void;

  constructor(onColorSelect: (color: string) => void) {
    this.onColorSelect = onColorSelect;
  }

  public show(x: number, y: number) {
    this.remove(); // Ensure only one menu exists

    this.host = document.createElement('div');
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
    `;
    this.shadowRoot.appendChild(style);

    const menu = document.createElement('div');
    menu.className = 'menu';

    const colors = ['#ffeb3b', '#a5d6a7', '#90caf9', '#ef9a9a'];
    colors.forEach((color) => {
      const btn = document.createElement('div');
      btn.className = 'color-btn';
      btn.style.backgroundColor = color;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent losing selection
        e.stopPropagation();
        this.onColorSelect(color);
        this.remove();
      });
      menu.appendChild(btn);
    });

    this.shadowRoot.appendChild(menu);
    document.body.appendChild(this.host);
  }

  public remove() {
    if (this.host) {
      this.host.remove();
      this.host = null;
      this.shadowRoot = null;
    }
  }
}
