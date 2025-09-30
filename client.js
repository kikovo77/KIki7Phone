// client.js - 推送通知客户端逻辑

// 这是一个全局变量，用于存储我们从服务器获取的VAPID公钥
let vapidPublicKey = '';
// 这是一个全局变量，用于存储用户订阅后的“订阅凭证”
let pushSubscription = null;

/**
 * 将 VAPID 公钥从 Base64 字符串转换为 Uint8Array 格式，这是 Push API 的要求
 * @param {string} base64String 
 * @returns {Uint8Array}
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

/**
 * 获取 VAPID 公钥
 */
async function getVapidKey() {
    try {
        const response = await fetch('/vapid-public-key');
        const key = await response.text();
        vapidPublicKey = key;
    } catch (error) {
        console.error('获取VAPID公钥失败:', error);
    }
}

/**
 * 核心函数：订阅推送通知
 */
async function subscribeUser() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('您的浏览器不支持推送通知。');
        return;
    }

    try {
        // 1. 获取已注册的 Service Worker
        const registration = await navigator.serviceWorker.ready;

        // 2. 检查是否已经订阅
        pushSubscription = await registration.pushManager.getSubscription();

        if (pushSubscription) {
            console.log('用户已经订阅过了。');
            // 如果需要，可以在这里处理取消订阅的逻辑
            return;
        }

        // 3. 如果未订阅，则发起订阅请求
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
        pushSubscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey
        });

        console.log('用户成功订阅:', JSON.stringify(pushSubscription));

        // 4. 将订阅信息发送到后端保存
        await fetch('/save-subscription', {
            method: 'POST',
            body: JSON.stringify(pushSubscription),
            headers: {
                'Content-Type': 'application/json'
            }
        });

        alert('通知已开启！');

    } catch (error) {
        console.error('订阅推送失败:', error);
        if (Notification.permission === 'denied') {
            alert('您已拒绝通知权限。请在浏览器设置中手动开启。');
        } else {
            alert('开启通知失败，请稍后再试。');
        }
    }
}


/**
 * 初始化推送通知功能
 */
async function initPushNotifications() {
    // 首先从后端获取VAPID公钥
    await getVapidKey();

    const enableNotificationsToggle = document.getElementById('enable-notifications-toggle');
    if (enableNotificationsToggle) {
        enableNotificationsToggle.addEventListener('click', async () => {
            // 检查当前权限状态
            if (Notification.permission === 'granted') {
                alert('您已经开启过通知了。');
                enableNotificationsToggle.checked = true; // 保持开关为开启状态
                return;
            }
            if (Notification.permission === 'denied') {
                alert('您已屏蔽通知权限，请前往浏览器或系统设置手动开启。');
                enableNotificationsToggle.checked = false; // 保持关闭
                return;
            }
            // 如果是 default 状态，则请求权限并订阅
            if (Notification.permission === 'default') {
                // 请求权限
                const permission = await Notification.requestPermission();
                if (permission === 'granted') {
                    console.log('用户授予了通知权限');
                    // 权限被授予后，立即执行订阅
                    await subscribeUser();
                    enableNotificationsToggle.checked = true;
                } else {
                    console.log('用户拒绝了通知权限');
                    enableNotificationsToggle.checked = false;
                }
            }
        });

        // 页面加载时检查现有状态，更新开关
        if ('serviceWorker' in navigator) {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            if (subscription && Notification.permission === 'granted') {
                enableNotificationsToggle.checked = true;
                pushSubscription = subscription; // 更新全局变量
            } else {
                enableNotificationsToggle.checked = false;
            }
        }
    }
}