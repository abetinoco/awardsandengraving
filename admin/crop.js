/* Crop-and-compress step for photo uploads.
 *
 * Why it exists: Daniel will upload straight from an iPhone — 3–12 MB, often
 * portrait, always the wrong shape for the slot. Without a crop step the photo
 * is squashed by object-fit or silently rejected for size. This lets him choose
 * the visible area, then re-encodes to a sane web size before upload, so the
 * bytes leaving his phone are not the bytes we serve.
 *
 * window.AE_CROP.open(file, aspect, maxEdge) -> Promise<Blob>
 *   aspect  — null for freeform
 *   maxEdge — longest output edge in px; defaults to MAX_EDGE. Gallery tiles
 *             pass a smaller number because they are never displayed large,
 *             and a 2400px square lands ~700 KB when ~90 KB would do.
 */
(function () {
  'use strict';

  var MAX_EDGE = 2400;      // full-bleed heroes — nothing is displayed larger
  var QUALITY = 0.82;
  var TYPE = 'image/webp';  // WebP out: smaller files mean less Supabase egress

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function load(file) {
    return new Promise(function (res, rej) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () { URL.revokeObjectURL(url); res(img); };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        // HEIC from an iPhone cannot be decoded by every browser.
        rej(new Error('That image format could not be opened. Try a JPG or PNG.'));
      };
      img.src = url;
    });
  }

  window.AE_CROP = {
    open: function (file, aspect, maxEdge) {
      var cap = maxEdge || MAX_EDGE;
      return load(file).then(function (img) {
        return new Promise(function (resolve, reject) {
          var iw = img.naturalWidth, ih = img.naturalHeight;

          // Start with the largest box of the requested shape that fits.
          var box;
          if (aspect) {
            var w = Math.min(iw, ih * aspect), hh = w / aspect;
            box = { x: (iw - w) / 2, y: (ih - hh) / 2, w: w, h: hh };
          } else {
            box = { x: 0, y: 0, w: iw, h: ih };
          }

          var VIEW = 460;
          var scale = Math.min(VIEW / iw, VIEW / ih);
          var cw = Math.round(iw * scale), ch = Math.round(ih * scale);

          var canvas = el('canvas', { width: cw, height: ch, class: 'crop-canvas' });
          var ctx = canvas.getContext('2d');

          function draw() {
            ctx.clearRect(0, 0, cw, ch);
            ctx.drawImage(img, 0, 0, cw, ch);
            ctx.fillStyle = 'rgba(19,32,56,.6)';
            ctx.fillRect(0, 0, cw, ch);
            var bx = box.x * scale, by = box.y * scale, bw = box.w * scale, bh = box.h * scale;
            ctx.save();
            ctx.beginPath(); ctx.rect(bx, by, bw, bh); ctx.clip();
            ctx.drawImage(img, 0, 0, cw, ch);
            ctx.restore();
            ctx.strokeStyle = '#d3b878'; ctx.lineWidth = 2;
            ctx.strokeRect(bx, by, bw, bh);
          }
          draw();

          // Drag to move the crop box; the wheel/slider resizes it about its centre.
          var dragging = false, last = null;
          canvas.addEventListener('mousedown', function (e) { dragging = true; last = { x: e.offsetX, y: e.offsetY }; });
          window.addEventListener('mouseup', function () { dragging = false; });
          canvas.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var dx = (e.offsetX - last.x) / scale, dy = (e.offsetY - last.y) / scale;
            box.x = Math.max(0, Math.min(iw - box.w, box.x + dx));
            box.y = Math.max(0, Math.min(ih - box.h, box.y + dy));
            last = { x: e.offsetX, y: e.offsetY };
            draw();
          });

          var zoom = el('input', { type: 'range', min: '20', max: '100', value: '100', class: 'crop-zoom' });
          zoom.addEventListener('input', function () {
            var pct = Number(zoom.value) / 100;
            var maxW = aspect ? Math.min(iw, ih * aspect) : iw;
            var maxH = aspect ? maxW / aspect : ih;
            var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
            box.w = maxW * pct; box.h = maxH * pct;
            box.x = Math.max(0, Math.min(iw - box.w, cx - box.w / 2));
            box.y = Math.max(0, Math.min(ih - box.h, cy - box.h / 2));
            draw();
          });

          function finish() {
            // Re-encode at a sensible size — the source may be 12 MB from a phone.
            var outW = Math.round(box.w), outH = Math.round(box.h);
            var k = Math.min(1, cap / Math.max(outW, outH));
            outW = Math.round(outW * k); outH = Math.round(outH * k);
            var out = document.createElement('canvas');
            out.width = outW; out.height = outH;
            out.getContext('2d').drawImage(img, box.x, box.y, box.w, box.h, 0, 0, outW, outH);
            out.toBlob(function (blob) {
              if (!blob) return reject(new Error('Could not process that image.'));
              close(); resolve(blob);
            }, TYPE, QUALITY);
          }

          var overlay = el('div', { class: 'crop-overlay' }, [
            el('div', { class: 'crop-box' }, [
              el('h3', { text: 'Position the photo' }),
              el('p', { class: 'crop-hint', text: aspect
                ? 'Drag to move, slide to zoom. The gold box is what will appear on the site.'
                : 'Drag to move, slide to zoom. Freeform — any shape is fine here.' }),
              canvas,
              el('div', { class: 'crop-tools' }, [el('span', { text: 'Zoom' }), zoom]),
              el('div', { class: 'crop-acts' }, [
                el('button', { class: 'btn-line', type: 'button', text: 'Cancel',
                  onclick: function () { close(); reject(new Error('cancelled')); } }),
                el('button', { class: 'btn-gold', type: 'button', text: 'Use this photo', onclick: finish }),
              ]),
            ]),
          ]);
          function close() { overlay.remove(); }
          document.body.appendChild(overlay);
        });
      });
    },
  };
})();
