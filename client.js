// client.js - v5.0 FINAL - 决定版 (硬编码VAPID密钥)

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

// --- 【核心修改】 ---
// 这个函数不再进行任何网络请求，直接使用已知的正确公钥。
async function getVapidKey() {
    // 1. 我们已经通过 curl 知道了正确的公钥，将它作为“真理”直接定义在这里
    const KNOWN_VAPID_PUBLIC_KEY = "BFVF_o36Q0I0Vj8BvSz0g00WDiqMYs9Jyf90-gvna592QzWNxS115WNWRHg4VjeFr61Ofa-BPATMOxKf4e1H74";

    // 2. 将这个“真理”赋值给全局变量
    vapidPublicKey = KNOWN_VAPID_PUBLIC_KEY;

    // 3. 同时，为了遵循最佳实践，我们把它存入本地，即使以后代码变了也能用
    localStorage.setItem('vapidPublicKey', KNOWN_VAPID_PUBLIC_KEY);

    console.log('已从代码内置的VAPID公钥完成初始化。');

    // 4. 直接返回，函数结束。没有任何失败的可能。
    return;
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
        await getVapidKey(); // 调用我们修改后的“绝对成功”的函数
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