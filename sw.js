/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-afac4cd2'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "pwa-maskable-512x512.png",
    "revision": "9a08a25ea24654fd31eb57af3ae3e8ec"
  }, {
    "url": "pwa-512x512.png",
    "revision": "014c8b6d283403eb8e40e39a164ee10e"
  }, {
    "url": "pwa-192x192.png",
    "revision": "4fe440e324f968785ed8b7b153f15f5a"
  }, {
    "url": "index.html",
    "revision": "6a021a949541c5a2788665e76dd46bdf"
  }, {
    "url": "icon.svg",
    "revision": "757c16c571946b18e9a09865c5f20eb2"
  }, {
    "url": "apple-touch-icon.png",
    "revision": "6d7733b947f5397dd370c715c6bf5e9b"
  }, {
    "url": "404.html",
    "revision": "6a021a949541c5a2788665e76dd46bdf"
  }, {
    "url": "dashboard/index.html",
    "revision": "179329496c4e50c09ce82eef7f963edd"
  }, {
    "url": "assets/stockscan.svg",
    "revision": null
  }, {
    "url": "assets/stockscan.png",
    "revision": null
  }, {
    "url": "assets/stockscan.js",
    "revision": null
  }, {
    "url": "assets/stockscan.css",
    "revision": null
  }, {
    "url": "assets/chunk-workbox-window.prod.es5.js",
    "revision": null
  }, {
    "url": "assets/chunk-chunk-workbox-window.prod.es5.js",
    "revision": null
  }, {
    "url": "assets/chunk-chunk-chunk-workbox-window.prod.es5.js",
    "revision": null
  }, {
    "url": "assets/chunk-chunk-chunk-chunk-workbox-window.prod.es5.js",
    "revision": null
  }, {
    "url": "assets/chunk-chunk-chunk-chunk-chunk-workbox-window.prod.es5.js",
    "revision": null
  }, {
    "url": "apple-touch-icon.png",
    "revision": "6d7733b947f5397dd370c715c6bf5e9b"
  }, {
    "url": "icon.svg",
    "revision": "757c16c571946b18e9a09865c5f20eb2"
  }, {
    "url": "pwa-192x192.png",
    "revision": "4fe440e324f968785ed8b7b153f15f5a"
  }, {
    "url": "pwa-512x512.png",
    "revision": "014c8b6d283403eb8e40e39a164ee10e"
  }, {
    "url": "pwa-maskable-512x512.png",
    "revision": "9a08a25ea24654fd31eb57af3ae3e8ec"
  }, {
    "url": "manifest.webmanifest",
    "revision": "b09d59a05ebbc9dc7b088f40762427e9"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("index.html")));
  workbox.registerRoute(/^https:\/\/fonts\.googleapis\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "google-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');
  workbox.registerRoute(/^https:\/\/fonts\.gstatic\.com\/.*/i, new workbox.CacheFirst({
    "cacheName": "gstatic-fonts-cache",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 10,
      maxAgeSeconds: 31536000
    }), new workbox.CacheableResponsePlugin({
      statuses: [0, 200]
    })]
  }), 'GET');

}));
