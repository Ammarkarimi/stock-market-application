// Applies the saved or system colour theme before first paint (external file so the CSP can forbid inline scripts).
(function () {
  try {
    var saved = localStorage.getItem('ss-theme');
    var dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    /* storage unavailable: fall back to the light theme */
  }
})();
