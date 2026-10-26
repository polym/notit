// Shared in-page primitives (architecture.md #12): every overlay builds from these instead of
// repeating DOM / CSS construction.
export { ColorChip, type ColorChipProps } from './ColorChip.tsx'
export { CommentIcon, DeleteIcon, IconButton, type IconButtonProps } from './IconButton.tsx'
export { TOAST_CSS, Toast, type ToastProps } from './Toast.tsx'
export { CommentEditor, type CommentEditorProps } from './CommentEditor.tsx'
export { isSaveChord } from './save-chord.ts'
export { COLOR_ORDER } from '../../palette.ts'
export { PRIMITIVES_CSS } from './styles.ts'
