// client.js - v3.0 FINAL - 智能缓存版

let vapidPublicKey = '';
let pushSubscription = null;

// 这个工具函数保持不变
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// --- 【核心修改在这里】 ---
async function getVapidKey() {
    // 1. 尝试从浏览器的小本本(localStorage)里读取之前存好的公钥
    const storedVapidKey = localStorage.getItem('vapidPublicKey');
    if (storedVapidKey) {
        console.log('从本地缓存成功读取VAPID公钥。');
        vapidPublicKey = storedVapidKey;
        return; // 如果读到了，就直接用，不发起网络请求
    }

    // 2. 如果本地没有（说明是用户第一次订阅），才通过网络去获取
    console.log('本地无缓存，正在从服务器获取VAPID公钥...');
    try {
        const response = await fetch(`${window.BACKEND_URL}/push-init-info`);
        if (!response.ok) throw new Error(`服务器响应错误: ${response.status}`);
        const key = await response.text();
        vapidPublicKey = key;

        // 3. 获取成功后，立即保存到本地的小本本(localStorage)里，方便下次直接用
        localStorage.setItem('vapidPublicKey', key);
        console.log('成功获取并缓存VAPID公钥。');

    } catch (error) {
        console.error('获取VAPID公钥失败:', error);
        alert(`连接后端服务失败，无法获取推送配置。\n错误: ${error.message}`);
        throw error;
    }
}

// 下面的函数基本保持不变，只是调用了上面那个新的 getVapidKey 函数
async function handleNotificationToggle(event) {
    const toggle = event.target;
    toggle.disabled = true;
    if (toggle.checked) {
        await subscribeUser().catch(() => { });
    } else {
        await unsubscribeUser().catch(() => { });
    }
    await updateToggleState();
    toggle.disabled = false;
}

async function subscribeUser() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('您的浏览器不支持推送通知。');
        throw new Error('Unsupported browser');
    }

    try {
        await getVapidKey(); // 调用我们修改后的智能函数
        const registration = await navigator.serviceWorker.ready;
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
        const permission = await Notification.requestPermission();

        if (permission !== 'granted') {
            console.log('用户拒绝了通知权限');
            alert('您已拒绝通知权限。如需开启，请在浏览器设置中手动操作。');
            throw new Error('Permission not granted');
        }

        pushSubscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey
        });

        const response = await fetch(`${window.BACKEND_URL}/save-subscription`, {
            method: 'POST',
            body: JSON.stringify(pushSubscription),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error('后端保存订阅信息失败');
        }

        console.log('用户成功订阅:', JSON.stringify(pushSubscription));
        localStorage.setItem('notificationsEnabled', 'true');
        alert('通知已开启！');

    } catch (error) {
        console.error('订阅推送失败:', error);
        localStorage.setItem('notificationsEnabled', 'false');
        if (error.message !== 'Permission not granted') {
            alert(`开启通知失败: ${error.message}`);
        }
        throw error;
    }
}

async function unsubscribeUser() {
    try {
        const registration = await navigator.serviceWorker.ready;
        pushSubscription = await registration.pushManager.getSubscription();

        if (pushSubscription) {
            await fetch(`${window.BACKEND_URL}/remove-subscription`, {
                method: 'POST',
                body: JSON.stringify({ endpoint: pushSubscription.endpoint }),
                headers: { 'Content-Type': 'application/json' }
            });

            const unsubscribed = await pushSubscription.unsubscribe();
            if (unsubscribed) {
                console.log('用户成功取消订阅。');
                pushSubscription = null;
            }
        }

        localStorage.setItem('notificationsEnabled', 'false');
        alert('通知已关闭。');

    } catch (error) {
        console.error('取消订阅失败:', error);
        alert('关闭通知失败，请稍后再试。');
        throw error;
    }
}

async function updateToggleState() {
    const enableNotificationsToggle = document.getElementById('enable-notifications-toggle');
    if (!enableNotificationsToggle) return;

    const userPreference = localStorage.getItem('notificationsEnabled');

    if (userPreference === 'false') {
        enableNotificationsToggle.checked = false;
        return;
    }

    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            if (subscription && Notification.permission === 'granted') {
                enableNotificationsToggle.checked = true;
                pushSubscription = subscription;
                localStorage.setItem('notificationsEnabled', 'true');
            } else {
                enableNotificationsToggle.checked = false;
                localStorage.setItem('notificationsEnabled', 'false');
            }
        } catch (error) {
            console.error("检查订阅状态时出错:", error);
            enableNotificationsToggle.checked = false;
        }
    }
}

async function initPushNotifications() {
    const enableNotificationsToggle = document.getElementById('enable-notifications-toggle');
    if (enableNotificationsToggle) {
        enableNotificationsToggle.addEventListener('change', handleNotificationToggle);
        await updateToggleState();
    }
}