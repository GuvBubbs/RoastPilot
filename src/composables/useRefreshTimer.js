import { ref, onMounted, onUnmounted } from 'vue';

const tick = ref(0);
let intervalId = null;
let subscriberCount = 0;

/**
 * Composable that provides a reactive tick value that updates periodically.
 * Components can depend on this to trigger re-renders for time-based displays.
 * 
 * @param {number} intervalMs - Update interval in milliseconds (default 30 seconds)
 */
export function useRefreshTimer(intervalMs = 30000) {
  onMounted(() => {
    subscriberCount++;
    
    // Start the interval if this is the first subscriber
    if (subscriberCount === 1) {
      intervalId = setInterval(() => {
        tick.value++;
      }, intervalMs);
    }
  });
  
  onUnmounted(() => {
    subscriberCount--;
    
    // Stop the interval if no more subscribers
    if (subscriberCount === 0 && intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  });
  
  return { tick };
}


