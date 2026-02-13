// service-worker.js - 修正并整合后的最终版本

// 【核心修改1】每次更新代码时，请修改这个版本号，强制浏览器更新缓存
const CACHE_NAME = 'kikiphone-cache-v1.31';
// 【核心修改2】列出所有您希望离线可用的静态资源文件
const urlsToCache = [
    '/', // 确保缓存根路径（通常指向 index.html）
    '/index.html',
    '/style.css',
    '/script.js',
    '/manifest.json',
    // 如果您有其他图片、字体文件、或子页面，请在这里添加它们的路径
    // 例如：'/images/icon.png', '/fonts/myfont.woff2', '/pages/settings.html'
    'https://tc-new.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250912/I4Xl/1206X1501/IMG_6556.jpeg/webp' // PWA图标
];

// --- 1. 安装 (Install Event) ---
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching essential assets:', urlsToCache);
                // 【核心修改3】缓存所有列出的资源
                return cache.addAll(urlsToCache);
            })
            // 【核心修改4】强制新的 Service Worker 立即取代旧的
            .then(() => self.skipWaiting())
            .catch((error) => {
                console.error('[Service Worker] Caching failed:', error);
            })
    );
});

// --- 2. 激活 (Activate Event) ---
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    // 【核心修改5】删除所有旧版本的缓存，只保留当前活跃的缓存
                    if (cacheName !== CACHE_NAME) {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                    return null;
                })
            );
        })
            // 【核心修改6】确保新的 Service Worker 激活后立即开始控制所有打开的页面
            .then(() => self.clients.claim())
            .then(() => console.log('[Service Worker] Activated and claimed clients.'))
    );
});

// --- 3. 拦截网络请求 (Fetch Event) ---
self.addEventListener('fetch', (event) => {
    // 【核心修改7】拦截所有网络请求，优先从缓存中响应
    // 确保只拦截 'http' 或 'https' 请求，避免拦截 chrome-extension:// 等非标准请求
    if (event.request.url.startsWith(self.location.origin) || event.request.url.startsWith('https://tc-new.z.wiki')) {
        event.respondWith(
            caches.match(event.request).then((response) => {
                // 如果缓存中有匹配的资源，直接返回
                if (response) {
                    console.log('[Service Worker] Responding from cache:', event.request.url);
                    return response;
                }
                // 如果缓存中没有，则从网络获取
                console.log('[Service Worker] Fetching from network:', event.request.url);
                return fetch(event.request).then((response) => {
                    // 确保响应是有效的，并且是基本请求（非插件等）
                    if (!response || response.status !== 200 || response.type !== 'basic') {
                        return response;
                    }
                    // 克隆响应，因为原始响应只能被读取一次
                    const responseToCache = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        console.log('[Service Worker] Caching new resource:', event.request.url);
                        cache.put(event.request, responseToCache);
                    });
                    return response;
                });
            }).catch((error) => {
                console.error('[Service Worker] Fetch failed and no cache match for:', event.request.url, error);
                // 可以在这里返回一个离线页面，例如 caches.match('/offline.html')
                // 目前简单处理，直接抛出错误或返回默认响应
                return new Response('<h1>Offline</h1>', {
                    headers: { 'Content-Type': 'text/html' }
                });
            })
        );
    }
});


// --- 4. 核心：监听来自后端的推送消息 (Push Event) ---
self.addEventListener('push', (event) => {
    console.log('[Service Worker] 收到推送消息！');

    let notificationData = {
        title: 'KikiPhone',
        body: '你有一条新消息',
        icon: 'https://tc-new.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250912/I4Xl/1206X1501/IMG_6556.jpeg/webp',
        tag: 'default-tag',
        data: {} // 用于存储额外数据，比如聊天ID
    };

    if (event.data) {
        try {
            const data = event.data.json();
            notificationData.title = data.title;
            notificationData.body = data.body;
            notificationData.icon = data.icon;
            notificationData.tag = `chat-${data.chatId}`; // 使用 tag 可以让来自同一个聊天的通知聚合或替换
            notificationData.data.chatId = data.chatId;
        } catch (e) {
            console.error('[Service Worker] 解析推送数据失败:', e);
            notificationData.body = event.data.text();
        }
    }

    const promiseChain = self.registration.showNotification(notificationData.title, {
        body: notificationData.body,
        icon: notificationData.icon,
        tag: notificationData.tag,
        data: notificationData.data // 将数据附加到通知上
    });

    event.waitUntil(promiseChain);
});

// --- 5. 处理通知的点击事件 (Notification Click Event) ---
self.addEventListener('notificationclick', (event) => {
    event.notification.close(); // 用户点击后，先关闭通知

    const chatId = event.notification.data.chatId;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // 检查是否已经有一个窗口打开了
            for (const client of clientList) {
                // 如果找到了对应的窗口（通过 URL 包含 'index.html' 判断），就聚焦并发送消息让它跳转
                if (client.url.includes('index.html') && 'focus' in client) {
                    client.focus();
                    // 通过 postMessage 告诉页面应该打开哪个聊天
                    return client.postMessage({ type: 'OPEN_CHAT', chatId: chatId });
                }
            }
            // 如果没有找到已打开的窗口，就打开一个新的
            if (clients.openWindow) {
                // 打开主页，让页面内部的 JS 处理跳转逻辑
                return clients.openWindow('/');
            }
        })
    );
});