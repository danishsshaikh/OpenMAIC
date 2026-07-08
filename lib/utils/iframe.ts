/**
 * In-memory localStorage/sessionStorage shim, injected as the FIRST thing in the
 * document so the page's own scripts see working storage.
 *
 * The interactive iframe is sandboxed `allow-scripts` WITHOUT `allow-same-origin`
 * (intentional — combining them negates the sandbox for LLM-authored HTML). In a
 * null-origin document, touching `window.localStorage` throws a SecurityError;
 * many generated pages read/write storage in their setup code, so that throw
 * crashes the script before anything renders → a blank/black widget. This shim
 * replaces both storages with an in-memory implementation when the real ones are
 * inaccessible, keeping the sandbox intact while letting storage-using pages run.
 */
const STORAGE_SHIM = `<script data-iframe-storage-shim>
(function () {
  function makeStore() {
    var data = Object.create(null);
    return {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = Object.create(null); },
      key: function (i) { var keys = Object.keys(data); return i < keys.length ? keys[i] : null; },
      get length() { return Object.keys(data).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var ok = false;
    try { var s = window[name]; if (s) { s.getItem('__probe__'); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
      try { Object.defineProperty(window, name, { value: makeStore(), configurable: true }); } catch (e) {}
    }
  });
})();
</script>`;

/**
 * Runtime-error capture, injected as the VERY FIRST script so it observes errors
 * from the storage shim and every page script that follows. Generated interactive
 * pages frequently die on a runtime error (a `JSON.parse` of malformed config, a
 * reference to a CDN lib that failed to load, …) → the script aborts and the
 * widget renders blank. The sandboxed (null-origin) iframe can't be read by the
 * editor, but it CAN `postMessage` out: this forwards `window.onerror`, unhandled
 * rejections and `console.error` to the parent, which stores them per scene and
 * feeds them to the editor agent — so it can diagnose a blank page instead of
 * guessing. Only touches `window.*` so it stays sandbox-safe and unit-testable.
 *
 * The most important errors (a `JSON.parse` that aborts setup) fire SYNCHRONOUSLY
 * while srcDoc parses — potentially before the parent has subscribed its `message`
 * listener (which it installs from a passive effect after inserting the iframe).
 * To avoid losing exactly the errors this feature exists to surface, every post is
 * also buffered, and the shim re-emits the whole buffer when the parent sends a
 * `{ __maicErrorReplayRequest: true }` message once its listener is ready. The
 * parent dedups, so the live + replayed copies collapse to one.
 */
const ERROR_CAPTURE_SHIM = `<script data-iframe-error-shim>
(function () {
  var buffer = [];
  function emit(errorKind, message) {
    try {
      window.parent.postMessage(
        { __maicInteractive: true, kind: 'runtime-error', errorKind: errorKind, message: message },
        '*'
      );
    } catch (e) {}
  }
  function post(errorKind, message) {
    message = String(message).slice(0, 1200);
    if (buffer.length < 50) buffer.push([errorKind, message]);
    emit(errorKind, message);
  }
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (d && d.__maicErrorReplayRequest === true) {
      for (var i = 0; i < buffer.length; i++) emit(buffer[i][0], buffer[i][1]);
    }
  });
  window.addEventListener('error', function (e) {
    if (e && e.message) {
      post('error', e.message + (e.filename ? ' (' + e.filename + ':' + (e.lineno || 0) + ')' : ''));
    } else if (e && e.target && (e.target.src || e.target.href)) {
      post('resource', 'Failed to load resource: ' + (e.target.src || e.target.href));
    }
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    post('unhandledrejection', (r && (r.stack || r.message)) || r || 'unhandled promise rejection');
  });
  try {
    var c = window.console;
    if (c && c.error) {
      var _ce = c.error;
      c.error = function () {
        try { post('console.error', Array.prototype.map.call(arguments, function (a) { return (a && a.stack) || String(a); }).join(' ')); } catch (e) {}
        return _ce.apply(c, arguments);
      };
    }
  } catch (e) {}
})();
</script>`;

/**
 * Generated interactive pages often paint a fixed-size diagram into a smaller
 * iframe. If only the iframe clips/scrolls, paths and labels can appear
 * disconnected from their intended layout. Fit the authored page as one unit
 * when it overflows, preserving relative arrow/label geometry.
 */
const FIT_SHIM = `<script data-iframe-fit-shim>
(function () {
  function isIgnorable(node) {
    return node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'LINK';
  }
  function textOf(node) {
    return String(node && node.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  }
  function commonAncestor(a, b) {
    var seen = [];
    var n = a;
    while (n) { seen.push(n); n = n.parentElement; }
    n = b;
    while (n) {
      if (seen.indexOf(n) !== -1) return n;
      n = n.parentElement;
    }
    return null;
  }
  function findStepControls(root) {
    var elements = Array.prototype.slice.call(root.querySelectorAll('button, [role="button"], div, section, nav'));
    var prev = null;
    var next = null;
    var step = null;
    for (var i = 0; i < elements.length; i++) {
      var text = textOf(elements[i]);
      if (!prev && text.indexOf('previous') !== -1 && text.indexOf('step') !== -1) prev = elements[i];
      if (!next && text.indexOf('next') !== -1 && text.indexOf('step') !== -1) next = elements[i];
      if (!step && /step\\s*\\d+\\s*\\/\\s*\\d+/.test(text)) step = elements[i];
    }
    if (!prev || !next) return null;
    var controls = commonAncestor(prev, next);
    if (controls && step) controls = commonAncestor(controls, step) || controls;
    while (controls && controls !== root) {
      var text = textOf(controls);
      if (text.indexOf('previous') !== -1 && text.indexOf('next') !== -1 && text.indexOf('step') !== -1) {
        return controls;
      }
      if (controls.parentElement === root) return controls;
      controls = controls.parentElement;
    }
    return null;
  }
  function installWrapper() {
    var body = document.body;
    if (!body || body.querySelector('[data-openmaic-fit-root]')) return;
    var wrapper = document.createElement('div');
    wrapper.setAttribute('data-openmaic-fit-root', '');
    var children = Array.prototype.slice.call(body.children).filter(function (child) {
      return !isIgnorable(child);
    });
    if (children.length === 0) return;
    children.forEach(function (child) { wrapper.appendChild(child); });
    body.appendChild(wrapper);
    var controls = findStepControls(wrapper);
    if (controls) {
      controls.setAttribute('data-openmaic-step-controls', '');
      body.appendChild(controls);
    }
  }
  function rectUnion(a, b) {
    if (!a) return b;
    return {
      left: Math.min(a.left, b.left),
      top: Math.min(a.top, b.top),
      right: Math.max(a.right, b.right),
      bottom: Math.max(a.bottom, b.bottom)
    };
  }
  function getContentBounds(root) {
    var bounds = null;
    var nodes = Array.prototype.slice.call(root.querySelectorAll('*'));
    nodes.unshift(root);
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (isIgnorable(node) || node.closest('[data-openmaic-step-controls]')) continue;
      var rect = node.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        bounds = rectUnion(bounds, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
      }
      if (
        typeof SVGGraphicsElement !== 'undefined' &&
        typeof DOMPoint !== 'undefined' &&
        node instanceof SVGGraphicsElement &&
        typeof node.getBBox === 'function'
      ) {
        try {
          var bbox = node.getBBox();
          var matrix = node.getScreenCTM && node.getScreenCTM();
          if (matrix && bbox.width > 0 && bbox.height > 0) {
            var points = [
              new DOMPoint(bbox.x, bbox.y).matrixTransform(matrix),
              new DOMPoint(bbox.x + bbox.width, bbox.y).matrixTransform(matrix),
              new DOMPoint(bbox.x, bbox.y + bbox.height).matrixTransform(matrix),
              new DOMPoint(bbox.x + bbox.width, bbox.y + bbox.height).matrixTransform(matrix)
            ];
            var xs = points.map(function (p) { return p.x; });
            var ys = points.map(function (p) { return p.y; });
            bounds = rectUnion(bounds, {
              left: Math.min.apply(Math, xs),
              top: Math.min.apply(Math, ys),
              right: Math.max.apply(Math, xs),
              bottom: Math.max.apply(Math, ys)
            });
          }
        } catch (e) {}
      }
    }
    return bounds;
  }
  function fit() {
    var body = document.body;
    var root = body && body.querySelector('[data-openmaic-fit-root]');
    if (!body || !root) return;

    root.style.transform = '';
    root.style.left = '0';
    root.style.top = '0';
    var bodyWidth = body.clientWidth || window.innerWidth;
    var bodyHeight = body.clientHeight || window.innerHeight;
    var controls = body.querySelector('[data-openmaic-step-controls]');
    if (controls) {
      controls.style.position = 'fixed';
      controls.style.left = '50%';
      controls.style.right = 'auto';
      controls.style.top = 'auto';
      controls.style.bottom = '12px';
      controls.style.transform = 'translateX(-50%)';
      controls.style.zIndex = '2147483647';
      controls.style.maxWidth = 'calc(100% - 24px)';
      controls.style.boxSizing = 'border-box';
    }
    var controlsRect = controls && controls.getBoundingClientRect ? controls.getBoundingClientRect() : null;
    var reservedBottom = controlsRect && controlsRect.height > 0 ? controlsRect.height + 24 : 0;
    var contentBounds = getContentBounds(root);
    var rootRect = root.getBoundingClientRect();
    if (!bodyWidth || !bodyHeight || !contentBounds || !rootRect.width || !rootRect.height) return;

    var contentWidth = Math.max(1, contentBounds.right - contentBounds.left);
    var contentHeight = Math.max(1, contentBounds.bottom - contentBounds.top);
    var localLeft = contentBounds.left - rootRect.left;
    var localTop = contentBounds.top - rootRect.top;

    var padding = 12;
    var availableWidth = Math.max(1, bodyWidth - padding * 2);
    var availableHeight = Math.max(1, bodyHeight - padding * 2 - reservedBottom);
    var scale = Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight);
    var fittedWidth = contentWidth * scale;
    var fittedHeight = contentHeight * scale;
    var left = padding + (availableWidth - fittedWidth) / 2 - rootRect.left - localLeft * scale;
    var top = padding + (availableHeight - fittedHeight) / 2 - rootRect.top - localTop * scale;

    root.style.transformOrigin = 'top left';
    root.style.transform = 'translate(' + left + 'px, ' + top + 'px) scale(' + scale + ')';
  }
  var pending = false;
  function scheduleFit() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function () {
      pending = false;
      installWrapper();
      fit();
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleFit);
  } else {
    scheduleFit();
  }
  window.addEventListener('load', scheduleFit);
  window.addEventListener('resize', scheduleFit);
  document.addEventListener('click', scheduleFit, true);
  if (window.MutationObserver) {
    var observer = new MutationObserver(scheduleFit);
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  setTimeout(scheduleFit, 100);
  setTimeout(scheduleFit, 500);
})();
</script>`;

/**
 * Patch embedded HTML to display correctly inside an iframe.
 *
 * Injects a runtime-error capture shim + a storage shim (so sandboxed pages that
 * use localStorage don't crash) plus CSS that ensures proper sizing and scrolling
 * behavior when HTML content is rendered via srcDoc in an iframe. The shims are
 * placed first so they run before the page's own scripts (error capture first, so
 * it also observes the storage shim).
 */
export function patchHtmlForIframe(html: string): string {
  const iframeCss = `<style data-iframe-patch>
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }
  /* Fix min-h-screen: in iframes 100vh is the iframe height, which is correct,
     but ensure body actually fills it */
  body { min-height: 100vh; }
  body {
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
  }
  [data-openmaic-fit-root] {
    position: absolute;
    left: 0;
    top: 0;
    width: max-content;
    min-width: 100%;
    min-height: 100%;
    transform-origin: top left;
  }
  [data-openmaic-step-controls] {
    transform-origin: center bottom;
  }
  [data-openmaic-fit-root] svg,
  [data-openmaic-fit-root] canvas {
    max-width: 100%;
  }
</style>`;

  const injection =
    '\n' + ERROR_CAPTURE_SHIM + '\n' + STORAGE_SHIM + '\n' + FIT_SHIM + '\n' + iframeCss;

  // Insert right after <head> or at the start of the document
  const headIdx = html.indexOf('<head>');
  if (headIdx !== -1) {
    const insertPos = headIdx + 6; // after <head>
    return html.substring(0, insertPos) + injection + html.substring(insertPos);
  }

  const headWithAttrs = html.indexOf('<head ');
  if (headWithAttrs !== -1) {
    const closeAngle = html.indexOf('>', headWithAttrs);
    if (closeAngle !== -1) {
      const insertPos = closeAngle + 1;
      return html.substring(0, insertPos) + injection + html.substring(insertPos);
    }
  }

  // Fallback: prepend
  return injection + html;
}
