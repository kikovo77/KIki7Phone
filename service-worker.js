// 核心后台管家 Service Worker：用于接管后台本地弹窗与拉起应用
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();

    // 提取保存在通知里的聊天ID数据
    const chatIdToOpen = event.notification.data ? event.notification.data.chatId : null;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // 如果已经有页面实例存在，不论前台后台
            if (windowClients.length > 0) {
                let client = windowClients[0];
                // 发送精准路由指令给前端 JS
                if (chatIdToOpen) {
                    client.postMessage({ type: 'OPEN_CHAT', chatId: chatIdToOpen });
                }
                return client.focus();
            }
            // 如果PWA彻底死掉了（连后台进程都没了），退火重开根目录
            if (clients.openWindow) {
                return clients.openWindow('/');
            }
        })
    );
});