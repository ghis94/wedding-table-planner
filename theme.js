/**
 * Wedding Planner - Theme Manager
 * Handles light/dark/system theme preference
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'wedding-theme';
  
  // Detect system preference
  function getSystemPreference() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }

  // Get stored or default preference
  function getStoredPreference() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
    return 'system';
  }

  // Apply theme to document
  function applyTheme(theme) {
    const effectiveTheme = theme === 'system' ? getSystemPreference() : theme;
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    document.body.classList.remove('theme-light', 'theme-dark', 'theme-system');
    document.body.classList.add('theme-' + theme);
  }

  // Save preference
  function savePreference(theme) {
    localStorage.setItem(STORAGE_KEY, theme);
    applyTheme(theme);
  }

  // Create and inject theme toggle UI
  function createThemeToggle(container) {
    const current = getStoredPreference();
    
    const wrapper = document.createElement('div');
    wrapper.className = 'theme-toggle';
    wrapper.innerHTML = `
      <span>🎨</span>
      <select id="theme-select" aria-label="Changer le thème">
        <option value="system" ${current === 'system' ? 'selected' : ''}>Système</option>
        <option value="light" ${current === 'light' ? 'selected' : ''}>Clair</option>
        <option value="dark" ${current === 'dark' ? 'selected' : ''}>Sombre</option>
      </select>
    `;
    
    const select = wrapper.querySelector('select');
    select.addEventListener('change', function() {
      savePreference(this.value);
    });
    
    // Listen for system theme changes
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function() {
        if (getStoredPreference() === 'system') {
          applyTheme('system');
        }
      });
    }
    
    if (container) {
      container.appendChild(wrapper);
    }
    
    return wrapper;
  }

  // Initialize on load
  function init() {
    applyTheme(getStoredPreference());
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose API
  window.ThemeManager = {
    setTheme: savePreference,
    getTheme: getStoredPreference,
    getSystemPreference: getSystemPreference,
    createToggle: createThemeToggle,
    applyTheme: applyTheme
  };

})();