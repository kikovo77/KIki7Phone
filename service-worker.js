// Service Worker V1.0 - 强制更新机制

// 监听 'install' 事件。当新的 Service Worker 被下载后触发。
self.addEventListener('install', event => {
    console.log('Service Worker: 正在安装新版本...');
    // 这是关键！命令新的 Service Worker 安装后不要等待，立即进入 "active" 状态。
    // 这相当于告诉新来的仓库管理员：“不用等了，马上接管工作！”
    self.skipWaiting();
});

// 监听 'activate' 事件。当新的 Service Worker 准备好接管页面时触发。
self.addEventListener('activate', event => {
    console.log('Service Worker: 新版本已激活，正在接管页面...');
    // 这是另一个关键！命令新的 Service Worker 立即控制所有当前打开的页面。
    // 相当于新管理员对所有顾客说：“现在由我为大家服务！”
    event.waitUntil(clients.claim());
});

// （我们将在后续步骤中，在这里添加 'push' 事件的监听逻辑来显示通知）
