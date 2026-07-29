// Simple, accessible tabs. Panels are shown/hidden via the `hidden` attribute.
// Also makes in-page links (e.g. the setup steps that point at #sensors or
// #visualizer) switch to the tab that contains their target, then scroll to it.

export function initTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  if (!tabs.length) return;

  const panelOf = (tab) => document.getElementById(tab.getAttribute('aria-controls'));
  const keyOf = (tab) => tab.id.replace(/^tab-/, '');

  function activate(tab, { focus = false, setHash = true } = {}) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      panelOf(t).hidden = !selected;
    });
    if (focus) tab.focus();
    if (setHash) history.replaceState(null, '', '#' + keyOf(tab));
  }

  // Screens that have been renamed, by the name they used to answer to. A link
  // somebody wrote down or bookmarked outlives the wording we settled on, so
  // the old key keeps working rather than landing on nothing.
  const RENAMED = { starters: 'sensing', config: 'controls', customize: 'design' };

  function activateKey(key, opts) {
    const tab = document.getElementById('tab-' + (RENAMED[key] ?? key));
    if (tab) activate(tab, opts);
    return !!tab;
  }

  // Tab bar clicks + arrow-key navigation.
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      activate(tabs[(i + dir + tabs.length) % tabs.length], { focus: true });
    });
  });

  // Delegated in-page links → jump to the right tab, then scroll to the anchor.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"], [data-tab-target]');
    if (!a) return;

    const explicit = a.dataset.tabTarget; // e.g. "setup" for the "Get started" button
    const href = a.getAttribute('href') || '';
    const target = explicit
      ? document.getElementById('panel-' + explicit)
      : href.length > 1
        ? document.getElementById(href.slice(1))
        : null;
    if (!target) return;

    const panel = target.closest('[role="tabpanel"]');
    if (!panel) return;

    e.preventDefault();
    activate(document.getElementById(panel.getAttribute('aria-labelledby')));
    (explicit ? panel : target).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Initial tab from the URL hash, else the first tab.
  if (!activateKey(location.hash.slice(1), { setHash: false })) {
    activate(tabs[0], { setHash: false });
  }
  window.addEventListener('hashchange', () => activateKey(location.hash.slice(1), { setHash: false }));

  return { activate: activateKey };
}
