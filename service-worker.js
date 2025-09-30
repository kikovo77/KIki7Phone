// service-worker.js - 最终版：具备强制更新、接收推送和处理点击的能力

// 监听 'install' 事件。
self.addEventListener('install', event => {
    console.log('Service Worker: 正在安装新版本...');
    // 强制新的 Service Worker 立即取代旧的，确保更新后马上生效
    self.skipWaiting();
});

// 监听 'activate' 事件。
self.addEventListener('activate', event => {
    console.log('Service Worker: 新版本已激活，正在接管页面...');
    // 确保新的 Service Worker 激活后立即开始控制所有打开的页面
    event.waitUntil(clients.claim());
});

// 监听 'push' 事件，这是接收后台推送的核心
self.addEventListener('push', event => {
    console.log('[Service Worker] 收到推送消息。');

    // 解析从服务器推送过来的数据
    const data = event.data.json();
    const title = data.title || '新消息';
    const options = {
        body: data.body,
        icon: data.icon,
        // 【关键】tag 用于将来自同一个聊天的多条通知聚合或替换，防止刷屏
        tag: `chat-${data.chatId}`,
        // 【关键】将 chatId 存入 data，以便点击时使用
        data: {
            chatId: data.chatId
        }
    };

    // 调用系统API，显示通知
    event.waitUntil(self.registration.showNotification(title, options));
});

// 监听 'notificationclick' 事件，处理用户点击通知的行为
self.addEventListener('notificationclick', event => {
    console.log('[Service Worker] 通知被点击。');

    // 用户点击后，先关闭通知
    event.notification.close();
    const chatId = event.notification.data.chatId;

    // 这个函数会查找并聚焦到已经打开的应用窗口，或者打开一个新窗口
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // 检查是否已经有一个窗口打开了我们的应用
            for (const client of clientList) {
                // 如果找到了，就把它切换到前台，并告诉它要打开哪个聊天
                if (client.url.includes('index.html') && 'focus' in client) {
                    client.focus();
                    // 通过 postMessage 将 chatId 发送给页面
                    return client.postMessage({ type: 'OPEN_CHAT', chatId: chatId });
                }
            }
            // 如果没有找到已打开的窗口，就打开一个新的
            if (clients.openWindow) {
                // 打开新窗口，并在加载后同样发送消息
                return clients.openWindow('./').then(client => {
                    if (client) {
                        // 这是一个变通方法，因为新开的窗口可能不会立刻监听到消息
                        // 我们可以在URL上传参，或者让页面加载后主动向SW查询
                        // 为了简单兼容，我们暂时只打开主页
                        return;
                    }
                });
            }
        })
    );
});