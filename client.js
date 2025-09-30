// client.js - v2.0 - 持久化开关 & 完整的订阅/取消订阅逻辑

// 【【【核心修改：在这里填入您云服务器的公网IP地址！】】】
const BACKEND_URL = 'http://139.9.33.118:3000';

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
        const response = await fetch(`${BACKEND_URL}/vapid-public-key`);
        if (!response.ok) throw new Error(`服务器响应错误: ${response.status}`);
        const key = await response.text();
        vapidPublicKey = key;
        console.log('成功获取VAPID公钥。');
    } catch (error) {
        console.error('获取VAPID公钥失败:', error);
        alert(`连接后端服务失败，无法获取推送配置。\n错误: ${error.message}`);
        throw error; // 【新增】抛出错误，中断后续流程
    }
}

/**
 * 核心函数：处理用户点击开关的逻辑
 */
async function handleNotificationToggle(event) {
    const toggle = event.target;
    if (toggle.checked) {
        // 用户想要开启通知
        await subscribeUser();
    } else {
        // 用户想要关闭通知
        await unsubscribeUser();
    }
    // 【新增】无论成功与否，都更新开关的最终状态并保存
    updateToggleState();
}

/**
 * 订阅推送
 */
async function subscribeUser() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        alert('您的浏览器不支持推送通知。');
        return;
    }

    try {
        await getVapidKey(); // 确保我们有公钥
        const registration = await navigator.serviceWorker.ready;
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

        // 请求权限
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            console.log('用户拒绝了通知权限');
            alert('您已拒绝通知权限。如需开启，请在浏览器设置中手动操作。');
            throw new Error('Permission not granted');
        }

        // 发起订阅
        pushSubscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey
        });

        // 发送到后端保存
        const response = await fetch(`${BACKEND_URL}/save-subscription`, {
            method: 'POST',
            body: JSON.stringify(pushSubscription),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error('后端保存订阅信息失败');
        }

        console.log('用户成功订阅:', JSON.stringify(pushSubscription));
        localStorage.setItem('notificationsEnabled', 'true'); // 【新增】保存状态
        alert('通知已开启！');

    } catch (error) {
        console.error('订阅推送失败:', error);
        localStorage.setItem('notificationsEnabled', 'false'); // 【新增】失败时保存为关闭状态
        alert(`开启通知失败: ${error.message}`);
    }
}

/**
 * 取消订阅推送
 */
async function unsubscribeUser() {
    try {
        const registration = await navigator.serviceWorker.ready;
        pushSubscription = await registration.pushManager.getSubscription();

        if (pushSubscription) {
            // 告诉后端删除这个订阅
            await fetch(`${BACKEND_URL}/remove-subscription`, {
                method: 'POST',
                body: JSON.stringify({ endpoint: pushSubscription.endpoint }),
                headers: { 'Content-Type': 'application/json' }
            });

            await pushSubscription.unsubscribe();
            console.log('用户成功取消订阅。');
            pushSubscription = null;
        }

        localStorage.setItem('notificationsEnabled', 'false'); // 【新增】保存状态
        alert('通知已关闭。');

    } catch (error) {
        console.error('取消订阅失败:', error);
        alert('关闭通知失败，请稍后再试。');
    }
}

/**
 * 【新增】根据现有状态更新开关的显示
 */
async function updateToggleState() {
    const enableNotificationsToggle = document.getElementById('enable-notifications-toggle');
    if (!enableNotificationsToggle) return;

    // 从 localStorage 读取用户意图
    const userPreference = localStorage.getItem('notificationsEnabled');

    if (userPreference === 'false') {
        enableNotificationsToggle.checked = false;
        return;
    }

    // 如果用户意图是开启（或未设置），则检查实际订阅状态
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.ready;
            const subscription = await registration.pushManager.getSubscription();
            if (subscription && Notification.permission === 'granted') {
                enableNotificationsToggle.checked = true;
                pushSubscription = subscription;
            } else {
                enableNotificationsToggle.checked = false;
                // 如果权限被拒绝了，也记录下来
                if (Notification.permission === 'denied') {
                    localStorage.setItem('notificationsEnabled', 'false');
                }
            }
        } catch (error) {
            console.error("检查订阅状态时出错:", error);
            enableNotificationsToggle.checked = false;
        }
    }
}


/**
 * 初始化推送通知功能
 */
async function initPushNotifications() {
    const enableNotificationsToggle = document.getElementById('enable-notifications-toggle');
    if (enableNotificationsToggle) {
        // 【核心修改】将事件监听器从 'click' 改为 'change'，并且直接绑定我们的总控函数
        enableNotificationsToggle.addEventListener('change', handleNotificationToggle);

        // 页面加载时，更新开关状态
        await updateToggleState();
    }
}