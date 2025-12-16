import { ref, onMounted } from 'vue';

export function usePWA() {
  const needRefresh = ref(false);
  const offlineReady = ref(false);
  const canInstall = ref(false);
  let deferredPrompt = null;
  
  onMounted(() => {
    // Handle PWA install prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      canInstall.value = true;
    });
    
    // Handle successful installation
    window.addEventListener('appinstalled', () => {
      canInstall.value = false;
      deferredPrompt = null;
    });
    
    // Check if running as installed PWA
    if (window.matchMedia('(display-mode: standalone)').matches) {
      canInstall.value = false;
    }
  });
  
  async function installPWA() {
    if (!deferredPrompt) return false;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    deferredPrompt = null;
    canInstall.value = false;
    
    return outcome === 'accepted';
  }
  
  function updateServiceWorker() {
    // This will be connected to the VitePWA update mechanism
    needRefresh.value = false;
    window.location.reload();
  }
  
  return {
    needRefresh,
    offlineReady,
    canInstall,
    installPWA,
    updateServiceWorker
  };
}

