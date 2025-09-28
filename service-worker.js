// service-worker.js

// 【第一部分：监听来自网页的消息】
// self 指代 Service Worker 本身。这里我们给它添加一个事件监听器。
self.addEventListener('message', event => {
    // 当网页通过 postMessage 发来消息时，这里的代码就会执行。
    console.log('Service Worker 收到了来自页面的消息:', event.data);

    // 从消息中解析出通知需要的数据
    const data = event.data;
    const title = data.title;
    const options = {
        body: data.body,
        icon: data.icon, // 通知的图标
        badge: data.icon, // Android 上状态栏的小图标
        tag: 'kiki-message-tag' // 给通知一个标签，防止同样的消息重复弹出
    };

    // self.registration.showNotification 就是 Service Worker 显示系统通知的“特权”方法
    // event.waitUntil 会确保在通知显示完毕前，Service Worker 不会意外休眠。
    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

// 【第二部分：监听用户对通知的点击】
// 当用户点击我们弹出的通知时，这里的代码会执行。
self.addEventListener('notificationclick', event => {
    // 关闭通知
    event.notification.close();

    // 这个函数会尝试找到你的应用窗口并激活它。
    // 如果找不到，它会打开一个新的窗口。
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            // 如果已经有窗口打开了，就激活第一个找到的窗口
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) {
                        client = clientList[i];
                    }
                }
                return client.focus();
            }
            // 如果没有窗口打开，就新开一个
            return clients.openWindow('/');
        })
    );
});