import { ref } from 'vue'

const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes('Files')

export function useFileDrop({ enabled = () => true, panel = () => null } = {}) {
  const dragging = ref(false)
  let depth = 0

  function reset() {
    depth = 0
    dragging.value = false
  }
  function enter(event) {
    if (!hasFiles(event) || !enabled()) return
    event.preventDefault()
    depth++
    dragging.value = true
  }
  function over(event) {
    if (!hasFiles(event) || !enabled()) {
      reset()
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    dragging.value = true
  }
  function leave(event) {
    depth = Math.max(0, depth - 1)
    // Child transitions also bubble. Keep the overlay while the next target is
    // inside the panel; use balanced enter/leave events when WebKit omits it.
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return
    if (event.relatedTarget || depth === 0) reset()
  }
  function drop(event) {
    reset()
    if (!hasFiles(event)) return []
    event.preventDefault()
    return enabled() ? Array.from(event.dataTransfer.files || []) : []
  }
  function outside(event) {
    if (dragging.value && !panel()?.contains(event.target)) reset()
  }
  function finish(event) {
    // Dropping a file elsewhere must not navigate the desktop webview away.
    if (event.type === 'drop' && hasFiles(event)) event.preventDefault()
    reset()
  }
  function keydown(event) {
    if (event.key === 'Escape') reset()
  }
  function bind(target) {
    const listeners = {
      dragover: outside,
      drop: finish,
      dragend: reset,
      blur: reset,
      pointermove: reset,
      keydown,
    }
    for (const [name, handler] of Object.entries(listeners)) target.addEventListener(name, handler)
    return () => {
      for (const [name, handler] of Object.entries(listeners))
        target.removeEventListener(name, handler)
      reset()
    }
  }
  return { dragging, enter, over, leave, drop, reset, bind }
}
