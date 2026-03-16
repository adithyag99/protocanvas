(function() {
  var es = new EventSource('/__reload');
  var myFile = location.pathname.split('/').pop();
  es.onmessage = function(e) {
    try {
      var data = JSON.parse(e.data);
      if (data.type === 'variant-changed' && data.file === myFile) {
        location.reload();
      }
    } catch(err) {
      if (e.data === 'reload') location.reload();
    }
  };
  es.onerror = function() {
    setTimeout(function() { location.reload(); }, 2000);
  };
})();
