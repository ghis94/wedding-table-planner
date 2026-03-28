(function() {
  'use strict';

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const navLinks = [
    { href: 'index.html', label: 'Accueil', icon: '🏠' },
    { href: 'admin.html', label: 'Admin', icon: '📋' },
    { href: 'staff.html', label: 'Staff', icon: '📱' },
    { href: 'visual.html', label: 'Plan visuel', icon: '🗺️' },
    { href: 'postcards.html', label: 'Cartes', icon: '💌' },
    { href: 'day-of.html', label: 'Jour J', icon: '💍' },
    { href: 'login.html', label: 'Connexion', icon: '🔐' }
  ];

  function createHeader() {
    const header = document.createElement('header');
    header.className = 'wedding-header';
    header.id = 'wedding-header';

    const navHtml = navLinks.map(link => {
      const isActive = link.href === currentPage;
      return `
        <a href="${link.href}" class="${isActive ? 'active' : ''}" aria-current="${isActive ? 'page' : 'false'}">
          <span class="nav-icon">${link.icon}</span>
          <span class="nav-label">${link.label}</span>
        </a>`;
    }).join('');

    header.innerHTML = `
      <div class="wedding-header__brand">
        <div class="brand-mark">✦</div>
        <div>
          <strong>Wedding Planner</strong>
          <span>Organisation élégante, vue unifiée</span>
        </div>
      </div>
      <nav class="wedding-nav">${navHtml}</nav>
      <div class="wedding-theme" id="wedding-theme-container"></div>
    `;

    return header;
  }

  function init() {
    if (document.getElementById('wedding-header')) return;
    const header = createHeader();
    const firstElement = document.body.firstChild;
    if (firstElement) document.body.insertBefore(header, firstElement);
    else document.body.appendChild(header);

    if (window.ThemeManager) {
      const container = document.getElementById('wedding-theme-container');
      window.ThemeManager.createToggle(container);
    }
  }

  function injectStyles() {
    if (document.getElementById('wedding-header-styles')) return;

    const styles = document.createElement('style');
    styles.id = 'wedding-header-styles';
    styles.textContent = `
      .wedding-header {
        position: sticky;
        top: 0;
        z-index: 100;
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 16px;
        padding: 14px 22px;
        background: linear-gradient(180deg, var(--surface-strong), var(--surface));
        border-bottom: 1px solid var(--line-soft);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
        box-shadow: var(--shadow-xs);
      }

      .wedding-header__brand {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }

      .brand-mark {
        width: 38px;
        height: 38px;
        display: grid;
        place-items: center;
        border-radius: 14px;
        background: linear-gradient(135deg, var(--accent-strong), var(--accent));
        color: #fffaf4;
        box-shadow: var(--shadow-sm);
      }

      .wedding-header__brand strong {
        display: block;
        font-size: 14px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      .wedding-header__brand span {
        display: block;
        font-size: 12px;
        color: var(--text-muted);
      }

      .wedding-nav {
        display: flex;
        justify-content: center;
        gap: 8px;
        flex-wrap: wrap;
      }

      .wedding-nav a {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 14px;
        color: var(--text-muted);
        font-size: 13px;
        font-weight: 700;
        transition: background .16s ease, color .16s ease, transform .16s ease;
      }

      .wedding-nav a:hover {
        background: var(--accent-ghost);
        color: var(--text);
        transform: translateY(-1px);
      }

      .wedding-nav a.active {
        background: linear-gradient(135deg, rgba(181,136,99,.2), rgba(181,136,99,.08));
        color: var(--accent-strong);
        box-shadow: inset 0 0 0 1px var(--line-soft);
      }

      .nav-icon {
        font-size: 14px;
      }

      .wedding-theme {
        display: flex;
        justify-content: flex-end;
      }

      @media (max-width: 980px) {
        .wedding-header {
          grid-template-columns: 1fr;
          justify-items: center;
          text-align: center;
        }

        .wedding-theme {
          justify-content: center;
        }
      }

      @media (max-width: 640px) {
        .wedding-header {
          padding: 12px 14px;
        }

        .wedding-nav a {
          padding: 9px 10px;
          font-size: 12px;
        }

        .nav-label {
          display: none;
        }
      }
    `;

    document.head.appendChild(styles);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      injectStyles();
      init();
    });
  } else {
    injectStyles();
    init();
  }
})();
