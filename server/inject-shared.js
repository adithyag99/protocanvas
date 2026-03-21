// Tab interaction
(function() {
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-tab]');
    if (!btn) return;
    var owner = btn.getAttribute('data-owner');
    var tab = btn.getAttribute('data-tab');
    var buttons = owner
      ? document.querySelectorAll('[data-tab][data-owner="' + owner + '"]')
      : btn.parentElement.querySelectorAll('[data-tab]');
    buttons.forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    var panels = owner
      ? document.querySelectorAll('[data-panel][data-owner="' + owner + '"]')
      : document.querySelectorAll('[data-panel]');
    panels.forEach(function(p) {
      p.style.display = p.getAttribute('data-panel') === tab ? '' : 'none';
    });
  });
})();

// Period tab interaction
(function() {
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-period]');
    if (!btn) return;
    var siblings = btn.parentElement.querySelectorAll('[data-period]');
    siblings.forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
  });
})();

// Size reporting to parent canvas
(function() {
  function reportSize() {
    var height = document.body.scrollHeight;
    var width = document.body.scrollWidth;
    window.parent.postMessage({ type: 'variant-height', height: height, width: width }, '*');
  }
  window.addEventListener('load', reportSize);
  var ro = new ResizeObserver(reportSize);
  ro.observe(document.body);
  window.addEventListener('beforeunload', function() { ro.disconnect(); });
})();
