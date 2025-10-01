// service-worker.js - 修正并整合后的最终版本

// --- 1. 安装与激活 ---
self.addEventListener('install', (event) => {
    // 强制新的 Service Worker 立即取代旧的，确保更新后马上生效
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    // 确保新的 Service Worker 激活后立即开始控制所有打开的页面
    event.waitUntil(self.clients.claim());
});

// --- 2. 核心：监听来自后端的推送消息 (Push Event) ---
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
            // 使用 tag 可以让来自同一个聊天的通知聚合或替换，而不是刷屏
            notificationData.tag = `chat-${data.chatId}`;
            notificationData.data.chatId = data.chatId;
        } catch (e) {
            console.error('解析推送数据失败:', e);
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

// --- 3. 处理通知的点击事件 ---
self.addEventListener('notificationclick', (event) => {
    event.notification.close(); // 用户点击后，先关闭通知

    const chatId = event.notification.data.chatId;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // 检查是否已经有一个窗口打开了
            for (const client of clientList) {
                // 如果找到了对应的窗口，就聚焦并发送消息让它跳转
                if (client.url.includes('index.html') && 'focus' in client) {
                    client.focus();
                    // 通过 postMessage 告诉页面应该打开哪个聊天
                    return client.postMessage({ type: 'OPEN_CHAT', chatId: chatId });
                }
            }
            // 如果没有找到已打开的窗口，就打开一个新的
            if (clients.openWindow) {
                // 可以在URL中附加参数，以便页面加载后直接跳转
                // 但为了简单起见，我们先只打开主页，让页面自己处理后续逻辑
                return clients.openWindow('/');
            }
        })
    );
});