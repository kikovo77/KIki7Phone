// client.js - v2.1 FINAL - 最终修复版

let vapidPublicKey = '';
let pushSubscription = null;

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

async function getVapidKey() {
    if (vapidPublicKey) return;
    try {
        // 【核心修改】使用在 index.html 中定义的全局变量
        const response = await fetch(`${window.BACKEND_URL}/vapid-public-key`);
        if (!response.ok) throw new Error(`服务器响应错误: ${response.status}`);
        const key = await response.text();
        vapidPublicKey = key;
        console.log('成功获取VAPID公钥。');
    } catch (error) {
        console.error('获取VAPID公钥失败:', error);
        alert(`连接后端服务失败，无法获取推送配置。\n错误: ${error.message}`);
        throw error;
    }
}

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
        await getVapidKey();
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

        // 【核心修改】使用在 index.html 中定义的全局变量
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
            // 【核心修改】使用在 index.html 中定义的全局变量
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