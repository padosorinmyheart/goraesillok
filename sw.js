/* 고래실록 서비스워커: 한 번 열어 둔 뒤에는 인터넷이 끊겨도 열리게 한다.
   기록은 여기서 다루지 않는다 (기록은 localStorage에만 있다). 캐시하는 것은 앱 파일뿐이다.
   캐시 방식을 바꾸면 CACHE 이름의 숫자를 올린다. */
var CACHE = "goraesillok.cache.v1"; // 앱의 저장 키(goraesillok.records.v1 등)와 같은 표기
var SHELL = ["./", "guide.html", "manifest.webmanifest", "favicon.ico", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
// PDF 만들 때 쓰는 라이브러리. index.html의 loadLibs와 주소가 같아야 한다.
var LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    // 라이브러리는 받아지면 좋고, 못 받아도 설치는 끝낸다 (PDF를 처음 만들 때 다시 받는다)
    var libs = LIBS.map(function (u) { return c.add(new Request(u, { mode: "cors", credentials: "omit" })).catch(function () {}); });
    return Promise.all([c.addAll(SHELL)].concat(libs));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf("goraesillok.cache.") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function put(req, res) {
  if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {}); }
  return res;
}
// 캐시에 있으면 그걸 쓰고, 없으면 받아서 넣어 둔다 (바뀌지 않는 파일용)
function cacheFirst(req) {
  return caches.match(req).then(function (hit) { return hit || fetch(req).then(function (res) { return put(req, res); }); });
}
// 캐시로 바로 답하고, 뒤에서 새로 받아 다음번에 쓴다
function staleWhileRevalidate(req) {
  return caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) { return put(req, res); });
    if (!hit) return net;
    net.catch(function () {});
    return hit;
  });
}
// 화면은 주소 꼬리(?…)나 index.html 표기가 달라도 한 자리에만 저장한다 (안 그러면 옛 화면이 따로 남는다)
function pageKey(req) {
  var u = new URL(req.url); u.search = ""; u.hash = "";
  u.pathname = u.pathname.replace(/\/index\.html$/, "/");
  return u.href;
}
// 화면(HTML)은 새 것이 먼저다. 인터넷이 없거나 3초 넘게 느리면 저장해 둔 화면으로 연다.
function pageFirst(req) {
  var key = pageKey(req);
  var cached = caches.open(CACHE).then(function (c) { return c.match(key); }).then(function (hit) { return hit || caches.match("./"); });
  var net = fetch(req).then(function (res) {
    // 서버가 잠깐 고장 나서(5xx) 오류 화면을 주면, 저장해 둔 화면이 있을 때는 그걸 쓴다
    if (res.status >= 500) return cached.then(function (hit) { return hit || res; });
    return put(key, res);
  });
  var slow = new Promise(function (ok) { setTimeout(ok, 3000); }).then(function () { return cached; });
  return Promise.race([net, slow.then(function (hit) { return hit || net; })])
    .catch(function () { return cached.then(function (hit) { return hit || Response.error(); }); });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === "navigate") e.respondWith(pageFirst(req));
    else e.respondWith(staleWhileRevalidate(req));
  } else if (url.hostname === "cdnjs.cloudflare.com") {
    e.respondWith(cacheFirst(req));
  } else if (url.hostname === "fonts.gstatic.com") {
    // 사파리는 글꼴을 no-cors로 요청한다. 그대로 받으면 내용을 볼 수 없는 응답이라 저장되지 않으므로 CORS로 다시 받는다.
    e.respondWith(cacheFirst(new Request(req.url, { mode: "cors", credentials: "omit" })));
  } else if (url.hostname === "fonts.googleapis.com") {
    // 글꼴 목록(CSS)도 같은 이유로 CORS로 다시 받아 둔다
    e.respondWith(staleWhileRevalidate(new Request(req.url, { mode: "cors", credentials: "omit" })));
  }
});
