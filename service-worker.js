// Service Worker 安装事件
self.addEventListener('install', event => {
    console.log('Service Worker installing.');
    // 可以选择在这里预缓存核心文件
});

// Service Worker 激活事件
self.addEventListener('activate', event => {
    console.log('Service Worker activating.');
});

// 拦截网络请求事件 (实现离线访问的基础)
self.addEventListener('fetch', event => {
    // 目前我们只记录请求，不做任何拦截处理
    // console.log('Fetching:', event.request.url);
});