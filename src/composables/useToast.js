import { ref } from 'vue';

const toasts = ref([]);
let toastId = 0;

export function useToast() {
  /**
   * Show a toast notification
   * @param {string} message - The message to display
   * @param {'success'|'error'|'warning'|'info'} [type='success'] - Toast type for styling
   * @param {number} [duration=3000] - Duration in milliseconds
   */
  function showToast(message, type = 'success', duration = 3000) {
    const id = ++toastId;
    
    toasts.value.push({
      id,
      message,
      type,
      visible: true
    });
    
    // Auto-dismiss after duration
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }
  
  /**
   * Dismiss a specific toast
   * @param {number} id
   */
  function dismissToast(id) {
    const index = toasts.value.findIndex(t => t.id === id);
    if (index !== -1) {
      // Mark as not visible to trigger exit animation
      toasts.value[index].visible = false;
      
      // Remove from array after animation completes
      setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
      }, 300);
    }
  }
  
  /**
   * Dismiss all toasts
   */
  function dismissAll() {
    toasts.value.forEach(t => t.visible = false);
    setTimeout(() => {
      toasts.value = [];
    }, 300);
  }
  
  return {
    toasts,
    showToast,
    dismissToast,
    dismissAll
  };
}
