// ===================================================================
// 【【【新增：将 client.js 的内容直接粘贴到这里】】】
// ===================================================================

// client.js - v2.0 - 持久化开关 & 完整的订阅/取消订阅逻辑

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
    // 1. 使用你 server.js 文件中定义的、100% 正确的公钥
    const KNOWN_VAPID_PUBLIC_KEY = "BFVF_o36Q0I0Vj8BvSzOg00WDiqMYs9Jyf9O-gvna592QzwNxs1I5WNWRHg4VjeFr61qOfa-BPATMOxKf4e1H74";

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
    // 【核心修改】增加一个加载状态，防止用户连续点击
    toggle.disabled = true;
    if (toggle.checked) {
        await subscribeUser().catch(() => { }); // 捕获错误防止程序中断
    } else {
        await unsubscribeUser().catch(() => { });
    }
    await updateToggleState(); // 根据最终结果更新状态
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
        // 只有在不是用户主动拒绝的情况下才弹窗
        if (error.message !== 'Permission not granted') {
            alert(`开启通知失败: ${error.message}`);
        }
        throw error; // 抛出错误让 handleNotificationToggle 知道失败了
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

// ===================================================================
// 【全新 V1.81 修复方案】IndexedDB 数据库帮助函数
// ===================================================================
const db = {
    _db: null,
    _dbName: 'KikiChatDB',
    _storeName: 'kv_store',

    async _getDB() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this._dbName, 1);
            request.onerror = () => reject("Error opening db");
            request.onsuccess = (event) => {
                this._db = event.target.result;
                resolve(this._db);
            };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(this._storeName)) {
                    db.createObjectStore(this._storeName);
                }
            };
        });
    },

    async get(key) {
        const db = await this._getDB();
        return new Promise((resolve) => {
            const transaction = db.transaction(this._storeName, 'readonly');
            const store = transaction.objectStore(this._storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(undefined);
        });
    },

    async set(key, value) {
        const db = await this._getDB();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(this._storeName, 'readwrite');
            const store = transaction.objectStore(this._storeName);
            const request = store.put(value, key);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject("Error setting value in db: " + e.target.error);
        });
    }
};

// ===================================================================
// 【全新】主题切换核心功能
// ===================================================================
const themes = [
    { id: 'imessage-day', name: 'iMessage日间主题', iconBg: '#ffffff', iconFill: '#007AFF', className: '' },
    { id: 'imessage-dark', name: 'iMessage暗黑主题', iconBg: '#242424', iconFill: '#303034', className: 'theme-dark' },
    { id: 'wechat', name: '仿微信主题', iconGradient: 'linear-gradient(to bottom, #19f957, #16ee53, #0de24a)', iconFill: '#ffffff', className: 'theme-wechat' },
    { id: 'ins', name: 'ins风主题', iconBg: '#383c3b', iconFill: '#ffe2f4', className: 'theme-ins' },
    { id: 'pop', name: '仿pop主题', iconBg: '#feeff6', iconFill: '#fed9ec', className: 'theme-pop' }
];
let currentThemeId = 'imessage-day'; // 默认主题

/**
 * 应用指定的主题
 * @param {string} themeId - 要应用的主题ID
 */
async function applyTheme(themeId) {
    const theme = themes.find(t => t.id === themeId);
    if (!theme) return;

    currentThemeId = themeId;
    await db.set('currentTheme', themeId); // 保存用户的选择

    // 移除所有可能存在的主题类名
    themes.forEach(t => {
        if (t.className) document.body.classList.remove(t.className);
    });

    // 如果新主题有关联的类名，则添加它
    if (theme.className) {
        document.body.classList.add(theme.className);
    }
}

/**
 * 加载并应用已保存的主题
 */
async function loadAndApplyTheme() {
    const savedThemeId = await db.get('currentTheme');
    if (savedThemeId && themes.find(t => t.id === savedThemeId)) {
        await applyTheme(savedThemeId);
    } else {
        await applyTheme('imessage-day'); // 如果没有保存或无效，则应用默认主题
    }
}
document.addEventListener('DOMContentLoaded', () => {

    /**  // ===================================================================
      // 【【【新增 PWA “后台管家” 注册代码】】】
      // ===================================================================
      if ('serviceWorker' in navigator) {
          window.addEventListener('load', () => {
              // 【核心修改】使用绝对路径来确保能准确找到文件
              navigator.serviceWorker.register('/KIki7Phone/service-worker.js')
                  .then(registration => {
                      console.log('Service Worker 注册成功，范围是:', registration.scope);
                      // 注册成功后，我们再次初始化/更新按钮状态，确保一切同步
                      initPushNotifications();
                  })
                  .catch(error => {
                      console.log('Service Worker 注册失败:', error);
                      // 可以在这里给用户一个更明确的提示
                      alert('后台服务模块加载失败，离线通知功能可能无法使用。');
                  });
          });
      } */

    // ===================================================================
    // 【全新 V2.03】全局变量统一定义区
    // ===================================================================
    // --- 屏幕与导航 ---
    const screens = document.querySelectorAll('.screen');
    const appIcons = document.querySelectorAll('.app-icon');
    const backBtns = document.querySelectorAll('.header-icon[data-target]');

    // 【【【全新 V5.8 核心修复】】】定义所有属于聊天上下文的页面ID
    const chatContextScreens = [
        'chat-interface-screen',
        'chat-settings-screen',
        'ai-info-screen',
        'my-info-screen',
        'manage-stickers-screen'
    ];

    // --- API 设置页面 ---
    const saveSettingsBtn = document.getElementById('save-api-settings-btn');
    const baseUrlInput = document.getElementById('base-url');
    const apiKeyInput = document.getElementById('api-key');
    const fetchModelsBtn = document.getElementById('fetch-models-btn');
    const modelSelect = document.getElementById('model-select');

    // --- 聊天列表页面 ---
    const addContactBtn = document.getElementById('add-contact-btn');
    const contactList = document.getElementById('contact-list');
    const addContactModal = document.getElementById('add-contact-modal');
    const newContactNameInput = document.getElementById('new-contact-name-input');
    const confirmCreateBtn = addContactModal.querySelector('.modal-confirm-btn');
    const cancelCreateBtn = addContactModal.querySelector('.modal-cancel-btn');

    // --- 聊天界面 ---
    const chatInterfaceScreen = document.getElementById('chat-interface-screen');
    const chatContactName = document.getElementById('chat-contact-name');
    const messageContainer = document.getElementById('message-container');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const generateBtn = document.getElementById('generate-btn');
    const moreFunctionsBtn = document.getElementById('more-btn');
    const moreFunctionsPanel = document.getElementById('more-functions-panel');
    const functionsSlider = document.getElementById('functions-slider');
    const functionsNavPrev = document.getElementById('functions-nav-prev');
    const functionsNavNext = document.getElementById('functions-nav-next');

    // --- 【V2.30 新增】消息交互相关变量 ---
    const messageContextMenu = document.getElementById('message-context-menu');
    const replyBar = document.getElementById('reply-bar');
    const replyBarContent = document.getElementById('reply-bar-content');
    const cancelReplyBtn = document.getElementById('cancel-reply-btn');

    // --- 表情系统 (聊天界面内) ---
    const stickerPanel = document.getElementById('sticker-panel');
    const stickerGrid = document.getElementById('sticker-grid');
    const openStickerPanelBtn = document.getElementById('open-sticker-panel-btn');

    // --- 表情系统 (全局弹窗与上传) ---
    const stickerFileInput = document.getElementById('sticker-file-input');
    const newAddStickerModal = document.getElementById('sticker-add-modal');
    const newStickerNameInput = document.getElementById('sticker-new-name-input');
    const newStickerUrlInput = document.getElementById('sticker-new-url-input');
    const newStickerUploadBtn = document.getElementById('sticker-new-upload-btn');
    const newStickerSaveBtn = document.getElementById('sticker-new-save-btn');

    // --- 聊天设置页面 ---
    const chatSettingsBtn = document.getElementById('chat-settings-btn');
    const chatSettingsScreen = document.getElementById('chat-settings-screen');
    const aiSettingsAvatar = document.getElementById('ai-settings-avatar');
    // 【核心修复】下面这两行是本次唯一的修改
    const aiSettingsNameDisplay = document.getElementById('ai-settings-name-display'); // 不再寻找旧的输入框
    const userSettingsAvatar = document.getElementById('user-settings-avatar');
    const userSettingsNameDisplay = document.getElementById('user-settings-name-display'); // 不再寻找旧的输入框
    const showAvatarsToggle = document.getElementById('show-avatars-toggle');
    const avatarRadiusInput = document.getElementById('avatar-radius-input');
    const fontSizeInput = document.getElementById('font-size-input');
    const clearHistoryBtn = document.getElementById('clear-history-btn');
    const avatarUploadInput = document.getElementById('avatar-upload-input');
    const aiInfoItem = document.getElementById('ai-info-item'); // 新增
    const userInfoItem = document.getElementById('user-info-item'); // 新增

    // --- 【全新 V2.03】对方信息页面 ---
    const aiInfoScreen = document.getElementById('ai-info-screen');
    const aiInfoAvatar = document.getElementById('ai-info-avatar');
    const aiInfoNameDisplay = document.getElementById('ai-info-name-display');
    const aiPersonaInput = document.getElementById('ai-persona-input');
    const aiRelationshipInput = document.getElementById('ai-relationship-input');
    const aiInfoAssociationsDropdown = document.getElementById('ai-info-associations-dropdown');
    const aiInfoDropdownLabel = document.getElementById('ai-info-dropdown-label');
    const aiInfoStickerPackList = document.getElementById('ai-info-sticker-pack-list');
    const saveAiInfoBtn = document.getElementById('save-ai-info-btn');

    // --- 【全新 V2.03】我的信息页面 ---
    const myInfoScreen = document.getElementById('my-info-screen');
    const myInfoAvatar = document.getElementById('my-info-avatar');
    const myInfoNameDisplay = document.getElementById('my-info-name-display');
    const myPersonaInput = document.getElementById('my-persona-input');
    const mySupplementaryInfoInput = document.getElementById('my-supplementary-info-input');
    const saveMyInfoBtn = document.getElementById('save-my-info-btn');

    // --- 【全新 V2.03】管理表情页面 ---
    const manageStickersScreen = document.getElementById('manage-stickers-screen');
    const stickerDeleteModeBtn = document.getElementById('sticker-delete-mode-btn');
    const deleteModeActions = document.querySelector('.delete-mode-actions');
    const confirmStickerDeleteBtn = document.getElementById('confirm-sticker-delete-btn');
    const cancelStickerDeleteBtn = document.getElementById('cancel-sticker-delete-btn');
    const stickerPackTitleEditor = document.getElementById('sticker-pack-title-editor');
    const stickerManagementGridView = document.getElementById('sticker-management-grid-view');

    // --- 样式与背景弹窗 ---
    const openBubbleStyleModalBtn = document.getElementById('open-bubble-style-modal-btn');
    const bubbleStyleModal = document.getElementById('bubble-style-modal');
    const userBubbleColorInput = document.getElementById('user-bubble-color-input');
    const aiBubbleColorInput = document.getElementById('ai-bubble-color-input');
    const userFontColorInput = document.getElementById('user-font-color-input');
    const aiFontColorInput = document.getElementById('ai-font-color-input');
    const customCssInput = document.getElementById('custom-css-input');
    const previewAiBubble = document.getElementById('preview-ai-bubble');
    const previewUserBubble = document.getElementById('preview-user-bubble');
    const saveBubbleStyleBtn = document.getElementById('save-bubble-style-btn');
    const openBackgroundModalBtn = document.getElementById('open-background-modal-btn');
    const backgroundModal = document.getElementById('background-modal');
    const backgroundPreview = document.getElementById('background-preview');
    const backgroundUploadInput = document.getElementById('background-upload-input');
    const removeBackgroundBtn = document.getElementById('remove-background-btn');
    const saveBackgroundBtn = document.getElementById('save-background-btn');

    // --- 主设置与字体设置页面 ---
    const phoneFrameToggle = document.getElementById('show-phone-frame-toggle');
    const gotoFontSettingsBtn = document.getElementById('goto-font-settings-btn');
    const fontSettingsPreviewBox = document.getElementById('font-settings-preview-box');
    const globalFontSizeInput = document.getElementById('global-font-size-input');
    const globalFontWeightInput = document.getElementById('global-font-weight-input');
    const globalLetterSpacingInput = document.getElementById('global-letter-spacing-input');
    const fontUrlInput = document.getElementById('font-url-input');
    const addFontBtn = document.getElementById('add-font-btn');
    const fontEntryList = document.getElementById('font-entry-list');
    const saveFontSettingsBtn = document.getElementById('save-font-settings-btn');
    const restoreFontDefaultsBtn = document.getElementById('restore-font-defaults-btn');

    // --- 桌面组件 ---
    const desktopFileInput = document.getElementById('desktop-file-input');
    const userCardBackground = document.getElementById('user-card-background');
    const userCardAvatar = document.getElementById('user-card-avatar');
    const recordInner = document.getElementById('record-inner');
    const capsuleIcon = document.querySelector('.capsule-widget .capsule-icon');
    const userIdText = document.getElementById('user-id');
    const userHandleText = document.getElementById('user-handle');
    const userBioText = document.getElementById('user-bio');
    const userLocationText = document.querySelector('#user-location span');
    const capsuleText = document.querySelector('.capsule-widget .capsule-text');

    // --- 情侣空间 ---
    const coupleSpaceScreen = document.getElementById('couple-space-screen');
    const coupleSpaceInviteScreen = document.getElementById('couple-space-invite-screen');
    const myAvatarWrapper = document.querySelector('.my-avatar-wrapper');
    const myAvatarImg = document.getElementById('couple-my-avatar-img');
    const partnerAvatarWrapper = document.querySelector('.partner-avatar-wrapper');
    const coupleAvatarUploadInput = document.getElementById('couple-avatar-upload-input');
    const coupleInviteListContainer = document.getElementById('couple-invite-list-container');
    const successToast = document.getElementById('success-toast');
    const coupleSpaceOptionsBtn = document.getElementById('couple-space-options-btn');
    const coupleThemeScreen = document.getElementById('couple-theme-screen');
    const coupleThemeBackBtn = document.getElementById('couple-theme-back-btn');
    const coupleThemeEditBtn = document.getElementById('couple-theme-edit-btn');
    const coupleBottomNav = document.querySelector('.couple-bottom-nav');
    const navSlider = document.querySelector('.nav-slider');
    const navIconWrappers = document.querySelectorAll('.nav-icon-wrapper');
    const coupleContentPages = document.querySelectorAll('.couple-content-page');
    const themeBgUploadBtn = document.getElementById('theme-bg-upload-btn');
    const themeResetBtn = document.getElementById('theme-reset-btn');
    const polaroidItems = document.querySelectorAll('.polaroid-item');

    // --- 邀请弹窗 ---
    const inviteModal = document.getElementById('couple-invite-modal');
    const inviteModalAiAvatar = document.getElementById('invite-modal-ai-avatar');
    const inviteModalUserAvatar = document.getElementById('invite-modal-user-avatar');
    const inviteAnimationContainer = document.querySelector('.invite-avatars-animation-container');
    const inviteAcceptBtn = document.getElementById('invite-accept-btn');
    const inviteRejectBtn = document.getElementById('invite-reject-btn');
    const inviteModalCloseBtn = document.querySelector('.invite-modal-close-btn');

    // --- 外观设置 ---
    const appearanceSettingsBtn = document.querySelector('.settings-item[data-target="appearance-settings-screen"]'); // 需要后续添加
    const gotoAppIconSettingsBtn = document.getElementById('goto-app-icon-settings-btn');
    const openDesktopWallpaperModalBtn = document.getElementById('open-desktop-wallpaper-modal-btn');
    const desktopWallpaperModal = document.getElementById('desktop-wallpaper-modal');
    const desktopWallpaperPreview = document.getElementById('desktop-wallpaper-preview');
    const removeDesktopWallpaperBtn = document.getElementById('remove-desktop-wallpaper-btn');
    const desktopWallpaperUploadInput = document.getElementById('desktop-wallpaper-upload-input');
    const saveDesktopWallpaperBtn = document.getElementById('save-desktop-wallpaper-btn');
    const appIconSettingsContainer = document.getElementById('app-icon-settings-container');

    // ===================================================================
    // 【【【全新】】】锁屏功能专属变量
    // ===================================================================
    const lockScreen = document.getElementById('lock-screen');
    const lockScreenTime = document.getElementById('lock-screen-time');
    const lockScreenDate = document.getElementById('lock-screen-date');
    const lockScreenCustomText = document.getElementById('lock-screen-custom-text');
    const lockScreenStatusIcons = document.getElementById('lock-screen-status-icons');

    const openLockscreenWallpaperModalBtn = document.getElementById('open-lockscreen-wallpaper-modal-btn');
    const lockscreenWallpaperModal = document.getElementById('lockscreen-wallpaper-modal');
    const lockscreenWallpaperPreview = document.getElementById('lockscreen-wallpaper-preview');
    const removeLockscreenWallpaperBtn = document.getElementById('remove-lockscreen-wallpaper-btn');
    const lockscreenWallpaperUploadInput = document.getElementById('lockscreen-wallpaper-upload-input');
    const saveLockscreenWallpaperBtn = document.getElementById('save-lockscreen-wallpaper-btn');

    let lockScreenSettings = {}; // 用于存储锁屏的壁纸和自定义文案

    // 【【【新增】】】获取锁屏左上角名字的元素
    const lockScreenName = document.getElementById('lock-screen-name');

    // --- 滑动解锁相关的状态变量 ---
    let touchStartY = 0;
    let currentTranslateY = 0;
    let isUnlocking = false;


    // --- 【【【新增】】】下拉锁屏相关的状态变量 ---
    const homeScreenForPullDown = document.getElementById('home-screen'); // 获取桌面元素
    let isPullingDown = false;      // 是否正在执行下拉操作
    let pullDownStartY = 0;         // 下拉开始的Y坐标
    let currentPullDownY = 0;       // 当前下拉的距离

    // --- 【【【新增】】】为桌面添加下拉手势监听 ---

    // --- 封装下拉逻辑以便复用 ---
    const startPullDown = (event) => {
        const homeScreen = document.getElementById('home-screen');
        const phoneWrapper = document.getElementById('phone-wrapper');
        const rect = phoneWrapper.getBoundingClientRect(); // 获取手机框的实时位置和尺寸

        // 【【【核心逻辑重构】】】
        // 1. 检查当前是否在桌面
        // 2. 检查锁屏是否已解锁
        // 3. 检查手势是否发生在手机框内部
        // 4. 检查手势是否从手机框的顶部区域（顶部向下50像素）开始
        if (homeScreen.classList.contains('active') &&
            lockScreen.classList.contains('unlocked') &&
            event.clientX >= rect.left && event.clientX <= rect.right &&
            event.clientY >= rect.top && event.clientY < rect.top + 50) {

            isPullingDown = true;
            pullDownStartY = event.clientY; // 使用事件的全局Y坐标
            lockScreen.classList.add('active');
            lockScreen.classList.remove('unlocked');
            lockScreen.classList.add('pulling-down');
            return true;
        }
        return false;
    };

    const movePullDown = (y) => {
        if (!isPullingDown) return;
        let diffY = y - pullDownStartY;
        if (diffY < 0) diffY = 0;
        currentPullDownY = diffY;
        const screenHeight = window.innerHeight;
        const translateY = Math.min(0, diffY - screenHeight);
        const opacity = Math.min(1, (diffY / (screenHeight / 2)));
        lockScreen.style.transform = `translateY(${translateY}px)`;
        lockScreen.style.opacity = opacity;
        const maxBlur = 10;
        const blurValue = Math.min(maxBlur, (diffY / screenHeight) * maxBlur * 2);
        homeScreenForPullDown.style.filter = `blur(${blurValue}px)`;
    };

    const endPullDown = () => {
        if (!isPullingDown) return;
        lockScreen.classList.remove('pulling-down');
        const screenHeight = window.innerHeight;
        if (currentPullDownY > screenHeight / 4) {
            isUnlocking = false;
            lockScreen.style.transform = 'translateY(0px)';
            lockScreen.style.opacity = '1';
            lockScreen.style.pointerEvents = 'auto';
            homeScreenForPullDown.style.filter = 'blur(0px)';
            homeScreenForPullDown.style.opacity = '0';
            homeScreenForPullDown.classList.remove('active');
        } else {
            lockScreen.style.transform = 'translateY(-100%)';
            lockScreen.style.opacity = '0';
            lockScreen.style.pointerEvents = 'none';
            homeScreenForPullDown.style.filter = 'blur(0px)';
            lockScreen.addEventListener('transitionend', () => {
                lockScreen.classList.add('unlocked');
                lockScreen.classList.remove('active');
            }, { once: true });
        }
        isPullingDown = false;
        pullDownStartY = 0;
        currentPullDownY = 0;
    };

    // --- 【【【核心修改】】】 将事件监听器绑定到全局 window 对象 ---

    // --- 触摸事件监听 ---
    window.addEventListener('touchstart', (e) => {
        startPullDown(e.touches[0]);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (isPullingDown) {
            e.preventDefault();
            movePullDown(e.touches[0].clientY);
        }
    }, { passive: false });

    window.addEventListener('touchend', endPullDown);
    window.addEventListener('touchcancel', endPullDown);

    // --- 鼠标事件监听 ---
    window.addEventListener('mousedown', (e) => {
        if (startPullDown(e)) { // 直接传递鼠标事件对象
            const handleMouseMove = (ev) => movePullDown(ev.clientY);
            const handleMouseUp = () => {
                endPullDown();
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
    });

    // ===================================================================
    // 【【【全新】】】锁屏功能核心函数
    // ===================================================================

    /**
     * 保存锁屏设置到 IndexedDB
     */
    async function saveLockScreenSettings() {
        try {
            await db.set('lockScreenSettings', lockScreenSettings);
        } catch (error) {
            console.error("Failed to save lockScreenSettings to IndexedDB:", error);
        }
    }

    /**
     * 从 IndexedDB 加载锁屏设置
     */
    async function loadLockScreenSettings() {
        const savedSettings = await db.get('lockScreenSettings') || {};
        lockScreenSettings = {
            wallpaper: savedSettings.wallpaper || '',
            customText: savedSettings.customText || '在此输入自定义文案...',
            name: savedSettings.name || 'name' // 【新增】加载名字，默认值为'name'
        };
    }

    /**
     * 将加载的设置应用到锁屏界面
     */
    function applyLockScreenSettings() {
        // 应用壁纸
        if (lockScreenSettings.wallpaper) {
            lockScreen.style.backgroundImage = `url(${lockScreenSettings.wallpaper})`;
            lockScreen.style.backgroundColor = ''; // 清除纯色背景
        } else {
            lockScreen.style.backgroundImage = 'none';
            lockScreen.style.backgroundColor = '#202020'; // 恢复默认纯色
        }
        // 应用自定义文案
        lockScreenCustomText.textContent = lockScreenSettings.customText;
        // 【新增】应用名字
        lockScreenName.textContent = lockScreenSettings.name;
    }

    /**
     * 更新锁屏上的时间和日期
     */
    function updateLockScreenTimeAndDate() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const weekday = weekdays[now.getDay()];

        if (lockScreenTime) lockScreenTime.textContent = `${hours}:${minutes}`;
        if (lockScreenDate) lockScreenDate.textContent = `${month}月${day}日 ${weekday}`;
    }

    /**
     * 处理锁屏上滑：手指按下
     */
    function handleTouchStart(e) {
        if (isUnlocking) return;
        touchStartY = e.touches[0].clientY;
        lockScreen.classList.add('unlocking');

        // 【BUG修复】不仅要改变透明度，还要把桌面设为 active 状态，准备显示
        const homeScreen = document.getElementById('home-screen');
        homeScreen.classList.add('active');
        homeScreen.style.opacity = '1';
    }

    /**
     * 处理锁屏上滑：手指移动
     */
    function handleTouchMove(e) {
        if (isUnlocking || touchStartY === 0) return;

        const currentY = e.touches[0].clientY;
        let diffY = touchStartY - currentY;

        // 只允许上滑，不允许向下滑动超过原始位置
        if (diffY < 0) diffY = 0;
        currentTranslateY = diffY;

        const screenHeight = window.innerHeight;
        // 计算滑动进度的百分比 (0到1之间)
        const swipeProgress = diffY / screenHeight;

        // 【【【核心修改1：非线性透明度】】】
        // 我们使用 swipeProgress 的三次方 (Math.pow(swipeProgress, 3))。
        // 这样，在滑动刚开始时 (swipeProgress很小)，透明度的降低会非常缓慢。
        // 随着滑动距离增加，透明度会加速降低，完美复刻iOS的“先慢后快”效果。
        const opacity = Math.max(0, 1 - Math.pow(swipeProgress, 3) * 2);

        // 【【【核心修改2：动态模糊效果】】】
        // 定义一个最大模糊值，比如20px
        const maxBlur = 20;
        // 将滑动进度映射到模糊值上，同样使用平方来制造“先慢后快”的模糊效果。
        const blurValue = Math.min(maxBlur, Math.pow(swipeProgress, 2) * maxBlur * 1.5);

        // 应用位移和透明度到锁屏
        lockScreen.style.transform = `translateY(-${diffY}px)`;
        lockScreen.style.opacity = opacity;

        // 【【【新增】】】将动态计算出的模糊效果应用到桌面
        document.getElementById('home-screen').style.filter = `blur(${blurValue}px)`;
    }

    function handleTouchEnd() {
        if (isUnlocking || touchStartY === 0) return;

        const homeScreen = document.getElementById('home-screen');
        lockScreen.classList.remove('unlocking'); // 重新开启CSS动画
        const screenHeight = window.innerHeight;

        // 如果滑动距离超过屏幕高度的 1/3，则判定为解锁
        if (currentTranslateY > screenHeight / 3) {
            isUnlocking = true;

            lockScreen.style.transform = 'translateY(-100%)';
            lockScreen.style.opacity = '0';
            lockScreen.style.pointerEvents = 'none';

            homeScreen.style.filter = 'blur(0px)';
            homeScreen.style.opacity = '1';

            lockScreen.addEventListener('transitionend', () => {
                lockScreen.classList.add('unlocked');
                // 【BUG修复】解锁完成后，正式移除锁屏的 active 状态
                lockScreen.classList.remove('active');
            }, { once: true });

        } else { // 否则，动画弹回原位
            lockScreen.style.transform = 'translateY(0px)';
            lockScreen.style.opacity = 1;

            // 【BUG修复】如果未解锁，则移除桌面的 active 状态，让它彻底隐藏
            homeScreen.style.opacity = '0';
            homeScreen.style.filter = 'blur(0px)';
            homeScreen.classList.remove('active');
        }

        // 重置滑动状态
        touchStartY = 0;
        currentTranslateY = 0;
    }

    // 【【【核心修改】】】将事件监听器绑定到新的 wrapper 上
    const customTextWrapper = document.getElementById('lock-screen-custom-text-wrapper');

    // 为 wrapper 添加触摸和鼠标事件监听，阻止滑动解锁手势冲突
    customTextWrapper.addEventListener('touchstart', (e) => {
        e.stopPropagation();
    });
    customTextWrapper.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    // 绑定自定义文案编辑事件
    customTextWrapper.addEventListener('click', () => {
        const tempInput = customTextWrapper.parentNode.querySelector('.temp-edit-input');
        if (tempInput) return;

        const originalValue = (lockScreenSettings.customText === '在此输入自定义文案...') ? '' : lockScreenSettings.customText;

        // 隐藏的是 wrapper 里的 span
        const textSpan = document.getElementById('lock-screen-custom-text');
        textSpan.style.display = 'none';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalValue;
        input.className = 'temp-edit-input';
        input.style.color = '#ccc';
        input.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        input.style.border = '1px solid #555';

        // 【【【核心新增】】】为新创建的输入框也添加触摸和鼠标事件，阻止冲突
        input.addEventListener('touchstart', (e) => {
            e.stopPropagation();
        });
        input.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        customTextWrapper.appendChild(input);
        input.focus();
        input.select();

        const save = () => {
            lockScreenSettings.customText = input.value.trim() || '在此输入自定义文案...';
            saveLockScreenSettings();
            applyLockScreenSettings();
            input.remove();
            textSpan.style.display = 'inline'; // 恢复显示 span
        };
        input.addEventListener('blur', save);
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') input.blur(); });
    });

    // 【【【全新】】】为锁屏名字区域绑定编辑功能
    lockScreenName.addEventListener('touchstart', (e) => {
        e.stopPropagation();
    });
    lockScreenName.addEventListener('mousedown', (e) => {
        e.stopPropagation();
    });

    lockScreenName.addEventListener('click', () => {
        const tempInput = lockScreenName.parentNode.querySelector('.temp-edit-input');
        if (tempInput) return;

        const originalValue = (lockScreenSettings.name === 'name') ? '' : lockScreenSettings.name;

        lockScreenName.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalValue;
        input.className = 'temp-edit-input';
        // 样式微调以适应左上角
        input.style.textAlign = 'left';
        input.style.color = '#4e4e4e';
        input.style.backgroundColor = 'rgba(0, 0, 0, 0.05)';
        input.style.border = '1px solid #ccc';

        input.addEventListener('touchstart', (e) => {
            e.stopPropagation();
        });
        input.addEventListener('mousedown', (e) => {
            e.stopPropagation();
        });

        lockScreenName.parentNode.insertBefore(input, lockScreenName.nextSibling);
        input.focus();
        input.select();

        const save = () => {
            // 【核心：长度限制】保存时，只取前5个字符
            const newName = input.value.trim().slice(0, 5);
            lockScreenSettings.name = newName || 'name'; // 如果为空，则恢复默认名
            saveLockScreenSettings();
            applyLockScreenSettings();
            input.remove();
            lockScreenName.style.display = 'inline';
        };
        input.addEventListener('blur', save);
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') input.blur(); });
    });

    // ===================================================================
    // 【【【全新】】】锁屏功能事件监听 (兼容鼠标)
    // ===================================================================
    // --- 触摸事件 ---
    lockScreen.addEventListener('touchstart', handleTouchStart, { passive: true });
    lockScreen.addEventListener('touchmove', handleTouchMove, { passive: false });
    lockScreen.addEventListener('touchend', handleTouchEnd);
    lockScreen.addEventListener('touchcancel', handleTouchEnd);

    // --- 【【【新增】】】鼠标事件 ---
    lockScreen.addEventListener('mousedown', (e) => {
        // 将鼠标事件包装成类似触摸事件的结构
        handleTouchStart({ touches: [{ clientY: e.clientY }] });

        // 在整个窗口上监听鼠标移动和抬起，以防鼠标移出锁屏区域
        const handleMouseMoveWrapper = (ev) => handleTouchMove({ touches: [{ clientY: ev.clientY }], preventDefault: () => ev.preventDefault() });
        const handleMouseUpWrapper = () => {
            handleTouchEnd();
            window.removeEventListener('mousemove', handleMouseMoveWrapper);
            window.removeEventListener('mouseup', handleMouseUpWrapper);
        };

        window.addEventListener('mousemove', handleMouseMoveWrapper);
        window.addEventListener('mouseup', handleMouseUpWrapper);
    });

    // 绑定自定义文案编辑事件
    lockScreenCustomText.addEventListener('click', () => {
        const tempInput = lockScreenCustomText.parentNode.querySelector('.temp-edit-input');
        if (tempInput) return;

        const originalValue = (lockScreenSettings.customText === '在此输入自定义文案...') ? '' : lockScreenSettings.customText;

        lockScreenCustomText.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalValue;
        input.className = 'temp-edit-input';
        input.style.color = '#ccc'; // 确保输入时颜色也协调
        input.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
        input.style.border = '1px solid #555';

        lockScreenCustomText.parentNode.insertBefore(input, lockScreenCustomText.nextSibling);
        input.focus();
        input.select();

        const save = () => {
            lockScreenSettings.customText = input.value.trim() || '在此输入自定义文案...';
            saveLockScreenSettings();
            applyLockScreenSettings();
            input.remove();
            lockScreenCustomText.style.display = 'inline';
        };
        input.addEventListener('blur', save);
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') input.blur(); });
    });

    // 绑定锁屏壁纸更换功能
    openLockscreenWallpaperModalBtn.addEventListener('click', () => {
        if (lockScreenSettings.wallpaper) {
            lockscreenWallpaperPreview.style.backgroundImage = `url(${lockScreenSettings.wallpaper})`;
            removeLockscreenWallpaperBtn.style.display = 'block';
        } else {
            lockscreenWallpaperPreview.style.backgroundImage = 'none';
            removeLockscreenWallpaperBtn.style.display = 'none';
        }
        lockscreenWallpaperModal.classList.add('visible');
    });

    lockscreenWallpaperPreview.addEventListener('click', () => lockscreenWallpaperUploadInput.click());

    lockscreenWallpaperUploadInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            const imageUrl = e.target.result;
            lockscreenWallpaperPreview.style.backgroundImage = `url(${imageUrl})`;
            removeLockscreenWallpaperBtn.style.display = 'block';
        };
        reader.readAsDataURL(file);
        lockscreenWallpaperUploadInput.value = '';
    });

    removeLockscreenWallpaperBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        lockscreenWallpaperPreview.style.backgroundImage = 'none';
        removeLockscreenWallpaperBtn.style.display = 'none';
    });

    saveLockscreenWallpaperBtn.addEventListener('click', () => {
        const bgStyle = lockscreenWallpaperPreview.style.backgroundImage;
        lockScreenSettings.wallpaper = bgStyle.startsWith('url') ? bgStyle.slice(5, -2) : '';
        saveLockScreenSettings();
        applyLockScreenSettings();
        lockscreenWallpaperModal.classList.remove('visible');
    });
    // ===================================================================
    // 【全新 V4.3】“Me”页面专属变量
    // ===================================================================
    const mePage = document.getElementById('me-page');
    const mePageAvatar = document.getElementById('me-page-avatar');
    const mePageName = document.getElementById('me-page-name');
    const mePageSignature = document.getElementById('me-page-signature');
    const meAvatarUploadInput = document.getElementById('me-avatar-upload-input');
    let mePageData = {}; // 用于存储“Me”页面的数据
    // --- 【【【全新 V5.2】】】拍摄照片弹窗相关变量 ---
    const photoDescriptionModal = document.getElementById('photo-description-modal');
    const photoDescriptionBtn = document.getElementById('func-btn-photo');
    const photoDescriptionConfirmBtn = document.getElementById('photo-description-confirm-btn');
    // --- 【【【全新】】】转账功能相关变量 ---
    const transferBtn = document.getElementById('func-btn-transfer');
    const transferModal = document.getElementById('transfer-modal');
    const transferAmountInput = document.getElementById('transfer-amount-input');
    const transferRemarksInput = document.getElementById('transfer-remarks-input');
    const transferConfirmBtn = document.getElementById('transfer-confirm-btn');
    const transferCancelBtn = document.getElementById('transfer-cancel-btn');
    const transferCloseBtn = document.getElementById('transfer-close-btn');
    // --- 【【【全新 V5.2 补充】】】发送真实照片功能相关变量 ---
    const photoUploadBtn = document.getElementById('func-btn-camera'); // 这是“照片”按钮
    const photoUploadInput = document.getElementById('photo-upload-input'); // 这是我们新加的隐藏input
    const photoDescriptionCancelBtn = document.getElementById('photo-description-cancel-btn');
    const photoDescriptionCloseBtn = document.getElementById('photo-description-close-btn');
    const photoDescriptionInput = document.getElementById('photo-description-input');

    // --- 【【【全新】】】语音转文字弹窗相关变量 ---
    const voiceToTextModal = document.getElementById('voice-to-text-modal');
    const voiceToTextBtn = document.getElementById('func-btn-voice');
    const voiceToTextConfirmBtn = document.getElementById('voice-to-text-confirm-btn');
    const voiceToTextCancelBtn = document.getElementById('voice-to-text-cancel-btn');
    const voiceToTextCloseBtn = document.getElementById('voice-to-text-close-btn');
    const voiceContentInput = document.getElementById('voice-content-input');
    const themes = [
        { id: 'imessage-day', name: 'iMessage日间主题', iconBg: '#ffffff', iconFill: '#007AFF', className: '' },
        { id: 'imessage-dark', name: 'iMessage暗黑主题', iconBg: '#242424', iconFill: '#303034', className: 'theme-dark' },
        { id: 'wechat', name: '仿微信主题', iconGradient: 'linear-gradient(to bottom, #19f957, #16ee53, #0de24a)', iconFill: '#ffffff', className: 'theme-wechat' },
        { id: 'ins', name: 'ins风主题', iconBg: '#383c3b', iconFill: '#ffe2f4', className: 'theme-ins' },
        { id: 'pop', name: '仿pop主题', iconBg: '#feeff6', iconFill: '#fed9ec', className: 'theme-pop' }
    ];
    let currentlyVisibleChatId = null; // 【【【核心新增】】】追踪当前正在屏幕上显示的聊天ID
    // --- 【V2.30】消息交互新增状态变量 ---
    let activeContextMenuMsgId = null; // 正在操作的消息ID
    let replyInfo = null; // {id, author, content}

    // 【【【核心修改】】】为插入模式定义更清晰的状态变量
    let insertMode = {
        active: false,          // 是否处于插入模式
        originalIndex: -1,      // 原始消息在 history 中的索引
        tempMessages: [],       // 临时的、正在编辑的消息数组
        isEditable: false       // 是否已经点击了“添加”按钮
    };

    // 【【【全新 V2.62】】】情侣空间与状态页新增变量
    const coupleStatusDetailScreen = document.getElementById('couple-status-detail-screen');
    const coupleStatusHeaderTitle = document.getElementById('couple-status-header-title');
    // --- 【【【全新】】】发布动态弹窗相关变量 ---
    const postStatusBtn = document.getElementById('post-status-btn');
    const postStatusModal = document.getElementById('post-status-modal');
    const statusModalCloseBtn = postStatusModal.querySelector('.status-modal-close-btn');
    const statusModalCancelBtn = postStatusModal.querySelector('.status-modal-action-btn.cancel');
    const coupleStatusMessageContainer = document.getElementById('couple-status-message-container');
    const statusInputPlaceholder = document.getElementById('status-input-placeholder');
    const statusInputActiveWrapper = document.getElementById('status-input-active-wrapper');
    const statusMessageInput = document.getElementById('status-message-input');
    const statusSendBtn = document.getElementById('status-send-btn');
    const coupleStatusOptionsBtn = document.getElementById('couple-status-options-btn');
    const coupleStatusContextMenu = document.getElementById('couple-status-context-menu');
    const breakupConfirmModal = document.getElementById('breakup-confirm-modal');
    const breakupConfirmText = document.getElementById('breakup-confirm-text');
    const breakupConfirmBtn = document.getElementById('breakup-confirm-btn');
    const breakupCancelBtn = document.getElementById('breakup-cancel-btn');
    const partnerAvatarImg = document.getElementById('couple-partner-avatar-img');
    const partnerAvatarPlaceholder = partnerAvatarWrapper.querySelector('.partner-avatar-placeholder');
    const breakupPopup = partnerAvatarWrapper.querySelector('.breakup-popup');
    const breakupCloseBtn = partnerAvatarWrapper.querySelector('.breakup-close-btn');

    // --- 【新增】状态页消息交互相关变量 ---
    const statusMessageContextCard = document.getElementById('status-message-context-card');
    const statusMultiSelectCancelBtn = document.getElementById('status-multi-select-cancel-btn');
    const statusMultiSelectDeleteBtn = document.getElementById('status-multi-select-delete-btn');
    const statusMultiSelectCounter = document.getElementById('status-multi-select-counter');

    let coupleStatusMessages = {}; // 用于存储每个情侣关系的状态页消息

    // --- 【【【全新 V3.9】】】添加状态弹窗相关变量 ---
    const addStatusModal = document.getElementById('add-status-modal');
    const addStatusCard = document.getElementById('add-status-card');
    const addStatusCloseBtn = document.getElementById('add-status-close-btn');

    // --- 【【【全新 V3.9.5】】】快捷删除模式相关变量 ---
    const statusDirectDeleteBtn = document.getElementById('status-direct-delete-btn');
    const addStatusCancelBtn = document.getElementById('add-status-cancel-btn');
    const addStatusSaveBtn = document.getElementById('add-status-save-btn');
    const statusDropdownContainer = document.querySelector('.status-dropdown-container');
    const statusDropdownHeader = document.querySelector('.status-dropdown-header');
    const statusDropdownList = document.querySelector('.status-dropdown-list');
    const statusSubjectSelector = document.getElementById('add-status-subject-selector');
    const statusTimeInput = document.getElementById('add-status-time-input');
    const statusContentInput = document.getElementById('add-status-content-input');

    // 定义可选择的状态列表
    const statusOptions = [
        { id: 'unlock', text: '还没入睡，刚刚解锁了手机', svg: '<svg t="1758903115001" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2348" width="19" height="19"><path d="M530.432 945.3568A434.176 434.176 0 0 1 491.52 78.6432a40.96 40.96 0 0 1 26.0096 70.8608 261.7344 261.7344 0 0 0-83.5584 192.3072 266.24 266.24 0 0 0 266.24 266.24 262.3488 262.3488 0 0 0 191.6928-82.944s0 1.024 0 0a40.96 40.96 0 0 1 70.656 24.576 434.176 434.176 0 0 1-432.128 395.6736z m0 0" p-id="2349" fill="#7347f7"></path></svg>' },
        { id: 'charge_start', text: '手机开始充电了', svg: '<svg t="1758955713450" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10961" width="15" height="15"><path d="M511.6806 0c-281.42411 0-511.6802 230.25609-511.6802 511.6802s230.25609 511.6802 511.6802 511.6802 511.6802-230.25609 511.6802-511.6802-230.25609-511.6802-511.6802-511.6802z" fill="#f75c4d" p-id="10962" data-spm-anchor-id="a313x.search_index.0.i4.21323a811dKEBi" class="selected"></path><path d="M697.804272 441.963773H621.052242c-19.188007 0-63.960025 6.396002-76.75203 0 0-12.792005 6.396002-31.980012 6.396003-38.376015 6.396002-25.58401 12.792005-57.564022 25.58401-83.148033l31.980012-121.524047c0-6.396002 0-12.792005-12.792005-19.188008-6.396002 0-12.792005 0-12.792005 6.396003L314.044122 557.091818c-6.396002 6.396002 0 12.792005 6.396003 19.188007h115.128045c6.396002 0 38.376015-6.396002 38.376015 0 6.396002 6.396002-6.396002 25.58401-6.396003 31.980013l-57.564022 211.068082c0 6.396002 0 12.792005 12.792005 19.188008 6.396002 0 12.792005 0 12.792005-6.396003L704.200275 461.15178c6.396002-6.396002 0-12.792005-6.396003-19.188007 6.396002 0 0 0 0 0z" fill="#ffffff" p-id="10963" data-spm-anchor-id="a313x.search_index.0.i5.21323a811dKEBi" class=""></path></svg>' },
        { id: 'charge_end', text: '手机结束了充电', svg: '<svg t="1758955713450" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10961" width="15" height="15"><path d="M511.6806 0c-281.42411 0-511.6802 230.25609-511.6802 511.6802s230.25609 511.6802 511.6802 511.6802 511.6802-230.25609 511.6802-511.6802-230.25609-511.6802-511.6802-511.6802z" fill="#42d93f" p-id="10962" data-spm-anchor-id="a313x.search_index.0.i4.21323a811dKEBi" class="selected"></path><path d="M697.804272 441.963773H621.052242c-19.188007 0-63.960025 6.396002-76.75203 0 0-12.792005 6.396002-31.980012 6.396003-38.376015 6.396002-25.58401 12.792005-57.564022 25.58401-83.148033l31.980012-121.524047c0-6.396002 0-12.792005-12.792005-19.188008-6.396002 0-12.792005 0-12.792005 6.396003L314.044122 557.091818c-6.396002 6.396002 0 12.792005 6.396003 19.188007h115.128045c6.396002 0 38.376015-6.396002 38.376015 0 6.396002 6.396002-6.396002 25.58401-6.396003 31.980013l-57.564022 211.068082c0 6.396002 0 12.792005 12.792005 19.188008 6.396002 0 12.792005 0 12.792005-6.396003L704.200275 461.15178c6.396002-6.396002 0-12.792005-6.396003-19.188007 6.396002 0 0 0 0 0z" fill="#ffffff" p-id="10963" data-spm-anchor-id="a313x.search_index.0.i5.21323a811dKEBi" class=""></path></svg>' },
        { id: 'arrive', text: '到达xxxx', svg: '<svg t="1758955883811" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="14839" width="16.5" height="16.5"><path d="M512 0C294.208 0 117.034667 177.152 117.056 394.922667c0 80.896 24.298667 158.677333 69.781333 224.149333 2.282667 3.925333 4.586667 7.722667 7.296 11.413333l288.277333 379.989333C490.24 1019.2 500.757333 1024 512.021333 1024c11.114667 0 21.696-4.842667 30.848-15.104l286.954667-378.474667c2.837333-3.754667 5.248-7.872 6.570667-10.282667 46.144-66.389333 70.570667-144.256 70.570667-225.173333C906.965333 177.152 729.792 0 512 0zM512 536.170667c-77.781333 0-141.077333-63.296-141.077333-141.098667 0-77.781333 63.296-141.056 141.077333-141.056 77.781333 0 141.077333 63.296 141.077333 141.056C653.077333 472.874667 589.781333 536.170667 512 536.170667z" p-id="14840" fill="#50e5cd"></path></svg>' },
        { id: 'steps', text: '步数已更新 xxxx步', svg: '<svg t="1758903704377" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="13338" width="16" height="16"><path d="M1024.091009 47.590705v0.199961l-2.299551 520.198399-1.499707 5.798867c-2.19957 8.198399-10.397969 29.294278-38.592462 45.291154-22.995509 12.997461-54.289397 19.596173-92.98184 19.596173h-4.899043c-48.890451-0.699863-111.078305-11.597735-184.963874-32.293693-44.691271-12.497559-84.783441-17.696544-120.57645-17.696544-87.382933 0-148.970904 30.793986-188.36321 60.888108-27.094708 20.695958-36.492872 57.288811-22.595587 88.382738l98.380785 220.856864c10.397969 23.19547-0.199961 50.79008-23.495411 61.188049-6.098809 2.699473-12.397579 3.999219-18.696349 3.999219-17.796524 0-34.893185-10.297989-42.4917-27.49463L3.990247 149.770748c-4.19918-9.398164-4.999024-19.596173-2.799453-29.094318 0.599883-3.699277 1.499707-7.398555 2.899434-10.997852C9.289213 96.081234 19.987123 84.783441 33.284526 78.884593 72.076949 61.487991 134.264803 37.092755 210.849845 20.096075 268.738539 7.198594 324.327682 0.699863 377.317332 0.699863c51.389963 0 100.380394 6.098809 146.471392 18.196446C636.166776 48.390549 716.251134 59.988284 776.439379 59.988284c86.083187 0 131.874243-23.595392 174.265963-51.989846l1.99961-1.299746c7.398555-4.499121 15.796915-6.698692 24.095294-6.698692 7.998438 0 15.996876 1.999609 23.195469 6.098809 14.89709 8.49834 24.195274 24.395235 24.095294 41.491896z" p-id="13339" fill="#ffda68"></path></svg>' },
        { id: 'leave', text: '离开家了', svg: '<svg t="1758905421214" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="129001" width="18" height="18"><path d="M917.333333 938.666667h-21.333333V96a53.393333 53.393333 0 0 0-53.333333-53.333333H181.333333a53.393333 53.393333 0 0 0-53.333333 53.333333v842.666667h-21.333333a21.333333 21.333333 0 0 0 0 42.666666h810.666666a21.333333 21.333333 0 0 0 0-42.666666z m-128-384H661.333333a21.333333 21.333333 0 0 1 0-42.666667h128a21.333333 21.333333 0 0 1 0 42.666667z m21.333334 64v256a21.333333 21.333333 0 0 1-42.666667 0V618.666667a21.333333 21.333333 0 0 1 42.666667 0z m-597.333334 320V149.333333a21.333333 21.333333 0 0 1 21.333334-21.333333h554.666666a21.333333 21.333333 0 0 1 21.333334 21.333333v298.666667a21.333333 21.333333 0 0 1-42.666667 0V170.666667H256v768z" fill="#55da84" p-id="129002"></path></svg>' },
        { id: 'solution', text: '刚刚解锁了手机', svg: '<svg t="1758961619404" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="87881" width="18" height="18"><path d="M513.948 64c115.945 0 210.151 93.087 212.024 208.622l0.028 3.508-0.001 55.87H784c70.692 0 128 57.308 128 128v368c0 70.692-57.308 128-128 128H240c-70.692 0-128-57.308-128-128V460c0-70.692 57.308-128 128-128h421.999l0.001-55.87C662 194.317 595.712 128 513.948 128c-74.864 0-137.62 55.896-146.878 129.365l-0.264 2.232c-1.945 17.565-17.762 30.229-35.328 28.284-17.565-1.945-30.229-17.762-28.284-35.328C315.031 145.656 405.614 64 513.948 64zM512 540c-17.673 0-32 14.327-32 32v144c0 17.673 14.327 32 32 32 17.673 0 32-14.327 32-32V572c0-17.673-14.327-32-32-32z" fill="#ffd861" p-id="87882"></path></svg>' },
        { id: 'screen', text: '屏幕使用xx分钟了', svg: '<svg t="1758959536744" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="59890" width="21.8" height="19"><path d="M820.409449 797.228346q0 25.19685-10.07874 46.866142t-27.716535 38.299213-41.322835 26.204724-50.897638 9.574803l-357.795276 0q-27.212598 0-50.897638-9.574803t-41.322835-26.204724-27.716535-38.299213-10.07874-46.866142l0-675.275591q0-25.19685 10.07874-47.370079t27.716535-38.80315 41.322835-26.204724 50.897638-9.574803l357.795276 0q27.212598 0 50.897638 9.574803t41.322835 26.204724 27.716535 38.80315 10.07874 47.370079l0 675.275591zM738.771654 170.330709l-455.559055 0 0 577.511811 455.559055 0 0-577.511811zM510.992126 776.062992q-21.165354 0-36.787402 15.11811t-15.622047 37.291339q0 21.165354 15.622047 36.787402t36.787402 15.622047q22.173228 0 37.291339-15.622047t15.11811-36.787402q0-22.173228-15.11811-37.291339t-37.291339-15.11811zM591.622047 84.661417q0-8.062992-5.03937-12.598425t-11.086614-4.535433l-128 0q-5.03937 0-10.582677 4.535433t-5.543307 12.598425 5.03937 12.598425 11.086614 4.535433l128 0q6.047244 0 11.086614-4.535433t5.03937-12.598425z" p-id="59891"></path></svg>' },
        { id: 'phone', text: '屏幕使用x小时了', svg: '<svg t="1758959536744" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="59890" width="21.8" height="19"><path d="M820.409449 797.228346q0 25.19685-10.07874 46.866142t-27.716535 38.299213-41.322835 26.204724-50.897638 9.574803l-357.795276 0q-27.212598 0-50.897638-9.574803t-41.322835-26.204724-27.716535-38.299213-10.07874-46.866142l0-675.275591q0-25.19685 10.07874-47.370079t27.716535-38.80315 41.322835-26.204724 50.897638-9.574803l357.795276 0q27.212598 0 50.897638 9.574803t41.322835 26.204724 27.716535 38.80315 10.07874 47.370079l0 675.275591zM738.771654 170.330709l-455.559055 0 0 577.511811 455.559055 0 0-577.511811zM510.992126 776.062992q-21.165354 0-36.787402 15.11811t-15.622047 37.291339q0 21.165354 15.622047 36.787402t36.787402 15.622047q22.173228 0 37.291339-15.622047t15.11811-36.787402q0-22.173228-15.11811-37.291339t-37.291339-15.11811zM591.622047 84.661417q0-8.062992-5.03937-12.598425t-11.086614-4.535433l-128 0q-5.03937 0-10.582677 4.535433t-5.543307 12.598425 5.03937 12.598425 11.086614 4.535433l128 0q6.047244 0 11.086614-4.535433t5.03937-12.598425z" p-id="59891"></path></svg>' },
        { id: 'call', text: '结束了接打电话 x分x秒', svg: '<svg t="1758904062586" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="26821" width="16" height="16"><path d="M232.641947 85.326223c27.048413 0 49.489209 23.464711 49.489209 51.622365 0 64.16532 9.556537 126.197484 28.157653 184.048662a54.864761 54.864761 0 0 1-12.030997 53.243563L200.559287 460.761603c66.725106 196.07966 208.707941 314.68311 344.71794 356.151654l78.500125-102.732772a47.526706 47.526706 0 0 1 50.59845-12.542955c55.462045 18.771769 115.019748 29.266894 176.625281 29.266895 26.963086 0 49.489209 23.464711 49.489209 51.622364v179.867678c0 28.669611-95.906674 61.520207-131.402383 61.520207C304.913257 1023.914674 0.042663 682.609783 0.042663 136.948588 0.042663 97.869178 32.551954 85.326223 59.600367 85.326223z m258.538455 298.64178c90.445796 0 163.826348 76.366969 163.826347 170.652445h-81.913173c0-47.100075-36.690276-85.326223-81.913174-85.326223v-85.326222z m0-170.652446c180.891592 0 327.567369 152.733939 327.567369 341.304891h-81.913174c0-141.385551-109.985501-255.978668-245.568869-255.978668v-85.326223z m0-170.652446c271.337389 0 491.308391 229.186234 491.308391 511.957337h-81.913174c0-235.585701-183.280727-426.631114-409.309891-426.631114v-85.326223z" fill="#26c824" p-id="26822"></path></svg>' },
        { id: 'hangup', text: '结束了与你的通话', svg: '<svg t="1758904104435" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="28039" width="20" height="20"><path d="M509.64 63c-247.7 0-448.5 200.8-448.5 448.5S261.94 960 509.64 960s448.5-200.8 448.5-448.5S757.34 63 509.64 63z m215.61 530.32c-24.18 0-67.4-13.89-84.9-19.55s-24.18-12.86-28.81-39.62-23.15-36-44.25-37c-14.07-0.68-36.82-0.68-50.42-0.61v0.1l-5.66-0.06-5.66 0.06v-0.1c-13.61-0.07-36.36-0.07-50.43 0.61-21.09 1-39.62 10.29-44.25 37s-11.32 34-28.81 39.62-60.71 19.55-84.9 19.55-28.3-58.66-28.3-58.66c0-76.66 190.89-97.76 216.14-97.76h52.48c25.21 0 216.1 21.1 216.1 97.76-0.03 0-4.14 58.66-28.33 58.66z" fill="#e34d39" p-id="28040"></path></svg>' },
        { id: 'aircondition', text: '打开了空调 xx℃', svg: '<svg t="1758904588885" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="58585" width="18" height="18"><path d="M902.826667 688.213333l-95.573334-55.04 75.52-20.053333c22.613333-5.973333 36.266667-29.44 30.293334-52.053333s-29.44-36.266667-52.053334-30.293334l-157.866666 42.24L597.333333 512l105.386667-61.013333 157.866667 42.24c3.84 0.853333 7.253333 1.28 11.093333 1.28 18.773333 0 36.266667-12.373333 40.96-31.573334a42.410667 42.410667 0 0 0-30.293333-52.053333l-75.52-20.053333 95.573333-55.04c20.48-11.946667 27.306667-37.973333 15.786667-58.453334a43.093333 43.093333 0 0 0-58.453334-15.786666l-95.573333 55.04 20.053333-75.52a42.410667 42.410667 0 0 0-30.293333-52.053334 42.410667 42.410667 0 0 0-52.053333 30.293334l-42.24 157.866666L554.666667 438.186667V316.16l115.626666-115.626667a42.496 42.496 0 1 0-60.16-60.16L554.666667 195.84V85.333333c0-23.466667-19.2-42.666667-42.666667-42.666666s-42.666667 19.2-42.666667 42.666666v110.506667l-55.04-55.466667A42.496 42.496 0 1 0 354.133333 200.533333L469.333333 316.16v121.6L363.946667 377.173333l-42.24-157.866666a42.410667 42.410667 0 0 0-52.48-29.866667c-22.613333 5.973333-36.266667 29.44-29.866667 52.053333l20.053333 75.52-95.573333-55.466666a43.093333 43.093333 0 0 0-58.453333 15.786666c-11.52 20.48-4.693333 46.506667 15.786666 58.453334l95.573334 55.04-75.52 20.053333c-22.613333 5.973333-36.266667 29.44-30.293334 52.053333 5.12 19.2 22.186667 31.573333 40.96 31.573334 3.84 0 7.253333-0.426667 11.093334-1.28l157.866666-42.24L426.666667 512l-105.386667 61.013333-157.866667-42.24c-22.613333-5.973333-46.08 7.253333-52.053333 30.293334s7.253333 46.08 30.293333 52.053333l75.52 20.053333-95.573333 55.04c-20.48 11.946667-27.306667 37.973333-15.786667 58.453334 7.68 13.653333 22.186667 21.333333 36.693334 21.333333 7.253333 0 14.506667-1.706667 21.333333-5.546667l95.573333-55.04-20.053333 75.52a42.410667 42.410667 0 0 0 41.386667 53.333334c18.773333 0 36.266667-12.373333 40.96-31.573334l42.24-157.866666L469.333333 585.813333v121.6l-115.626666 115.626667A42.496 42.496 0 1 0 413.866667 883.2l55.466666-55.04V938.666667c0 23.466667 19.2 42.666667 42.666667 42.666666s42.666667-19.2 42.666667-42.666666v-110.506667l55.04 55.04c8.533333 8.533333 19.2 12.8 30.293333 12.8s21.76-4.266667 30.293333-12.373333a42.496 42.496 0 0 0 0-60.16L554.666667 707.84v-121.6l105.386666 61.013333 42.24 157.866667c5.12 19.2 22.186667 31.573333 40.96 31.573333 3.84 0 7.253333-0.426667 11.093334-1.28 22.613333-5.973333 36.266667-29.44 30.293333-52.053333l-20.053333-75.52 95.573333 55.04c6.826667 3.84 14.08 5.546667 21.333333 5.546667 14.933333 0 29.013333-7.68 37.12-21.333334 11.52-20.906667 4.693333-46.933333-15.786666-58.88z" p-id="58586" fill="#90c5f8"></path></svg>' },
        { id: 'close', text: '关闭了空调', svg: '<svg t="1758961076095" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="83691" width="18" height="18"><path d="M512 522.3m-469.5 0a469.5 469.5 0 1 0 939 0 469.5 469.5 0 1 0-939 0Z" fill="#2dbf9f" p-id="83692" data-spm-anchor-id="a313x.search_index.0.i152.21323a811dKEBi" class="selected"></path><path d="M346.2 303.2m-40.9 0a40.9 40.9 0 1 0 81.8 0 40.9 40.9 0 1 0-81.8 0Z" fill="#FFFFFF" p-id="83693"></path><path d="M675.2 300.7m-40.9 0a40.9 40.9 0 1 0 81.8 0 40.9 40.9 0 1 0-81.8 0Z" fill="#FFFFFF" p-id="83694"></path><path d="M512 551.1c-22.6 0-41-18.3-41-41V242c0-22.6 18.3-41 41-41 22.6 0 41 18.3 41 41v268.1c0 22.7-18.4 41-41 41z" fill="#FFFFFF" p-id="83695"></path><path d="M701.2 268.9l-53.8 62c57.9 42 95.5 110.1 95.5 187 0 127.5-103.4 230.9-230.9 230.9S281.1 645.5 281.1 517.9c0-73 33.9-138 86.7-180.3l-45.5-68.3C247.5 326.4 199.2 416.6 199.2 518c0 172.7 140 312.8 312.8 312.8s312.8-140 312.8-312.8c0-101.7-48.5-192-123.6-249.1z" fill="#FFFFFF" p-id="83696"></path></svg>' },
        { id: 'outside', text: '为你下单了外卖', svg: '<svg t="1758961847563" class="icon" viewBox="0 0 1035 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="90216" width="27" height="27"><path d="M3.328 0m349.090909 0l325.818182 0q349.090909 0 349.090909 349.090909l0 325.818182q0 349.090909-349.090909 349.090909l-325.818182 0q-349.090909 0-349.090909-349.090909l0-325.818182q0-349.090909 349.090909-349.090909Z" fill="#ffd861" p-id="90217" data-spm-anchor-id="a313x.search_index.0.i189.21323a811dKEBi" class="selected"></path><path d="M299.415273 608.058182c0 23.121455 19.525818 41.844364 43.601454 41.844363 24.110545 0 43.636364-18.734545 43.636364-41.844363 0-23.133091-19.525818-41.832727-43.636364-41.832727-24.087273 0-43.601455 18.699636-43.601454 41.832727z m367.662545 41.844363c24.110545 0 43.636364-18.734545 43.636364-41.844363 0-23.133091-19.525818-41.832727-43.636364-41.832727-24.075636 0-43.613091 18.699636-43.613091 41.832727 0 23.121455 19.537455 41.844364 43.613091 41.844363z m-38.574545-179.339636h43.461818c1.361455 0 2.850909 0.337455 4.305454 0.558546 1.175273-0.151273 2.292364-0.558545 3.49091-0.558546h72.692363c24.087273 0 58.158545 36.805818 58.158546 59.822546v9.681454c0 15.127273-17.442909 14.08-39.610182 13.893818A109.137455 109.137455 0 0 1 785.291636 607.883636c0 62.72-52.910545 113.570909-118.202181 113.570909-45.032727 0-84.130909-24.203636-104.122182-59.776H447.138909C427.124364 697.250909 387.909818 721.454545 342.842182 721.454545 277.434182 721.454545 224.418909 670.603636 224.418909 607.883636c0-38.225455 19.805091-71.831273 49.989818-92.404363a39.528727 39.528727 0 0 1-1.093818-9.053091l27.368727-43.752727c-23.202909-11.717818-38.469818-33.047273-38.469818-52.072728V395.636364c0-24.785455 20.596364-44.823273 45.975273-44.823273h94.522182c19.397818-20.130909 52.212364-43.205818 68.584727-34.141091 20.922182 11.589818 13.789091 42.554182 5.387636 61.917091l-15.243636 37.003636v9.937455c0 20.456727-14.103273 37.504-33.326545 42.845091-21.294545 75.613091 59.938909 115.362909 112.721454 59.077818 1.861818-3.025455 3.456-6.202182 4.805818-9.483636l0.314182 0.256c18.525091-40.226909 64.593455-46.708364 82.548364-47.674182z m148.037818-36.037818H607.313455c-25.518545 0-46.149818-18.967273-46.149819-42.356364V321.629091c0-23.389091 20.642909-42.344727 46.149819-42.344727h169.227636c25.472 0 46.149818 18.944 46.149818 42.344727v70.562909c0 23.365818-20.677818 42.344727-46.149818 42.344727z" fill="#FFFFFF" p-id="90218"></path></svg>' },
        { id: 'music', text: '加入了一起听', svg: '<svg t="1758904826237" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="75049" data-spm-anchor-id="a313x.search_index.0.i181.6fc13a81gF1pWB" width="18" height="18"><path d="M714.752 936.448l-45.056-17.408 166.912-426.496c7.168-18.944-2.048-40.448-20.992-47.616-0.512-0.512-1.536-0.512-2.048-0.512l-291.84-95.232c-18.944-6.144-38.912 3.584-46.08 22.016l-145.408 384.512-68.608-26.112L465.92 189.44c6.656-18.432 26.624-27.648 45.568-22.016L947.712 302.08c19.456 6.144 30.208 26.624 24.576 46.08-0.512 1.024-0.512 1.536-1.024 2.56L748.032 921.6c-5.12 13.312-19.968 19.968-33.28 14.848z" fill="#94a7f0" p-id="75050" data-spm-anchor-id="a313x.search_index.0.i174.6fc13a81gF1pWB" class=""></path><path d="M50.176 703.488c1.536 80.384 68.096 143.872 147.968 142.336 77.824-1.536 140.8-64.512 142.336-142.336 1.536-80.384-61.952-146.432-142.336-147.968-80.384-1.536-146.432 61.952-147.968 142.336v5.632zM468.992 865.792c0 80.384 65.024 145.408 145.408 144.896 80.384 0 145.408-65.024 144.896-145.408s-65.024-145.408-145.408-144.896c-79.872 0-144.896 65.024-144.896 145.408z" fill="#94a7f0" p-id="75051" data-spm-anchor-id="a313x.search_index.0.i175.6fc13a81gF1pWB" class=""></path><path d="M201.216 390.656L84.48 97.792c-7.168-17.92 1.536-38.4 19.456-45.568 1.024-0.512 2.048-0.512 2.56-1.024l121.344-36.864c15.872-5.12 33.28 2.56 40.448 17.92l14.848 32.256c7.68 16.896 0.512 36.864-16.384 44.544-1.024 0.512-2.56 1.024-3.584 1.536L180.224 138.24c-7.68 2.56-11.264 10.24-9.216 17.92 0 0.512 0 0.512 0.512 1.024L250.368 358.4c2.56 6.144-0.512 12.8-6.144 15.36l-43.008 16.896z" fill="#c2baf6" p-id="75052" data-spm-anchor-id="a313x.search_index.0.i177.6fc13a81gF1pWB" class="selected"></path><path d="M67.072 390.656c0 52.736 42.496 95.232 95.232 95.232s95.232-42.496 95.232-95.232S215.04 295.424 162.304 295.424 67.072 337.92 67.072 390.656z" fill="#c2baf6" p-id="75053" data-spm-anchor-id="a313x.search_index.0.i176.6fc13a81gF1pWB" class=""></path></svg>' },
        { id: 'signal', text: '连接了移动数据', svg: '<svg t="1758960639698" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="71831" width="16" height="16"><path d="M105.8816 972.8C75.6736 972.8 51.2 948.3264 51.2 918.1184V699.1872c0-30.208 24.4736-54.6816 54.6816-54.6816s54.6816 24.4736 54.6816 54.6816v218.9312c0.1024 30.208-24.3712 54.6816-54.6816 54.6816z m270.7456 0c-30.208 0-54.6816-24.4736-54.6816-54.6816V491.8272c0-30.208 24.4736-54.6816 54.6816-54.6816 30.208 0 54.6816 24.4736 54.6816 54.6816v426.2912c0.1024 30.208-24.4736 54.6816-54.6816 54.6816z m270.7456 0c-30.208 0-54.6816-24.4736-54.6816-54.6816V307.5072c0-30.208 24.4736-54.6816 54.6816-54.6816 30.208 0 54.6816 24.4736 54.6816 54.6816v610.6112c0 30.208-24.4736 54.6816-54.6816 54.6816z m270.7456 0c-30.208 0-54.6816-24.4736-54.6816-54.6816V105.8816C863.3344 75.6736 887.808 51.2 918.1184 51.2S972.8 75.6736 972.8 105.8816v812.1344c0 30.3104-24.4736 54.784-54.6816 54.784z" fill="#3fd4dd" p-id="71832"></path></svg>' },
        { id: 'network', text: '连接了WiFi', svg: '<svg t="1758960550503" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="71367" width="20" height="20"><path d="M350.848 720a224 224 0 0 1 316.8 0l-158.4 158.464z m485.568-173.44l5.504 5.312-90.56 90.56a336 336 0 0 0-471.168-3.968l-3.968 3.968-90.496-90.56a464 464 0 0 1 650.688-5.376z m166.912-172.544l8.32 8.192-90.56 90.496A576 576 0 0 0 113.28 466.048l-6.784 6.656L16 382.208c272.192-272.192 711.808-274.944 987.328-8.192z" fill="#515151" p-id="71368"></path></svg>' },
        { id: 'angry', text: '更新了状态 生气了', svg: '<svg t="1758904994619" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="90646" width="16" height="16"><path d="M805.376 120.832c-52.736 109.056-164.352 184.32-293.888 184.32-129.536 0-241.152-75.264-293.888-184.32-4.608-9.216-12.8-46.08 11.264-32.768 10.752 6.144 21.504 12.288 31.232 17.92 68.608 39.936 118.272 69.12 251.392 69.12 141.824 0 217.088-46.592 270.848-79.872 4.096-2.56 7.68-5.12 11.776-7.168 20.48-12.288 18.944 17.92 11.264 32.768zM305.664 512c0-129.536-75.264-241.152-184.32-293.888-14.848-7.168-45.056-9.216-32.768 11.264 2.048 3.584 4.608 7.68 7.168 11.776 33.28 53.76 79.872 128.512 79.872 270.848 0 132.608-29.184 182.784-69.12 251.392-5.632 9.728-11.776 19.968-17.92 31.232-13.312 24.064 23.552 15.872 32.768 11.264 109.056-52.736 184.32-164.352 184.32-293.888z m412.672 0c0-129.536 75.264-241.152 184.32-293.888 14.848-7.168 45.056-9.216 32.768 11.264-2.048 3.584-4.608 7.68-7.168 11.776-33.28 53.76-79.872 128.512-79.872 270.848 0 132.608 29.184 182.784 69.12 251.392 5.632 9.728 11.776 19.968 17.92 31.232 13.312 24.064-23.552 15.872-32.768 11.264-109.056-52.736-184.32-164.352-184.32-293.888zM512 718.336c129.536 0 241.152 75.264 293.888 184.32 7.168 14.848 9.216 45.056-11.264 32.768-3.584-2.048-7.68-4.608-11.776-7.168-53.76-33.28-128.512-79.872-270.848-79.872-132.608 0-182.784 29.184-251.392 69.12-9.728 5.632-19.968 11.776-31.232 17.92-24.064 13.312-15.872-23.552-11.264-32.768 52.736-109.056 164.352-184.32 293.888-184.32z" p-id="90647" fill="#ef3c25"></path></svg>' },
        { id: 'eat', text: '更新了状态 吃饭中', svg: '<svg t="1758905301425" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="121437" width="18" height="18"><path d="M191.767273 918.341818 191.767273 918.341818c-18.618182 0-37.632-5.725091-51.037091-15.476364-11.869091-8.448-19.386182-23.668364-21.061818-42.379636-2.048-22.760727 4.468364-45.637818 16.709818-58.507636 15.313455-15.988364 230.469818-219.368727 279.598545-265.774545l-22.574545-24.715636c-9.053091 1.047273-26.042182 2.466909-43.52 2.466909-15.313455 0-27.950545-1.163636-37.515636-3.514182-6.376727-1.559273-17.361455-6.749091-46.056727-33.163636-18.129455-16.779636-40.192-39.144727-62.021818-63.069091-19.269818-21.201455-82.688-92.462545-91.485091-123.787636C101.166545 248.948364 107.031273 200.96 108.055273 193.163636c0.256-20.549818 9.448727-57.856 42.612364-57.856 21.061818 0 47.080727 16.244364 79.383273 49.547636 18.385455 18.850909 224.093091 227.165091 270.917818 274.501818l28.066909-29.509818c-12.264727-11.310545-30.370909-30.696727-34.327273-49.943273-5.352727-26.135273 0.512-38.237091 12.125091-62.417455 1.140364-2.327273 2.304-4.677818 3.560727-7.284364 19.898182-41.728 166.912-175.918545 192.186182-195.700364 7.540364-5.841455 15.429818-8.843636 23.598545-8.843636 13.661091 0 26.554182 8.843636 33.442909 22.877091 5.748364 11.706182 5.492364 24.064-0.512 32.232727-8.936727 11.962182-139.217455 148.503273-156.206545 166.190545-4.212364 5.469091-13.265455 20.805818-7.912727 26.391273 0.512 0.512 1.024 0.907636 2.56 0.907636 6.888727 0 17.873455-8.052364 22.085818-11.822545 8.029091-8.075636 141.521455-142.638545 153.530182-154.205091 6.772364-6.632727 14.801455-10.146909 23.342545-10.146909 15.941818 0 28.578909 12.218182 33.954909 24.180364 5.352727 11.962182 4.212364 24.064-2.932364 32.372364-11.240727 13.125818-145.850182 163.584-151.598545 169.937455l-0.372364 0.512c-1.792 1.954909-9.821091 11.054545-3.700364 19.106909 0.884364 1.163636 1.536 1.442909 2.816 1.442909 5.748364 0 15.197091-6.376727 19.269818-9.890909 6.772364-6.888727 141.777455-142.382545 156.834909-157.719273 5.492364-5.469091 12.753455-8.448 21.061818-8.448 16.965818 0 36.631273 12.613818 43.776 28.090182 4.468364 9.611636 3.444364 19.502545-2.676364 27.042909-0.628364 0.768-1.536 1.954909-2.792727 3.514182-37.655273 46.685091-72.610909 87.249455-103.889455 120.669091-83.968 89.856-115.106909 100.258909-131.188364 100.258909-2.048 0-4.096-0.116364-6.004364-0.512-26.786909-5.329455-50.408727-21.317818-63.418182-31.604364l-31.138909 36.933818c46.452364 46.149818 261.725091 260.049455 271.546182 269.800727 9.053091 8.983273 17.477818 29.649455 16.337455 51.874909-1.024 18.850909-8.797091 34.722909-22.597818 45.777455-12.637091 10.146909-29.346909 15.732364-47.080727 15.732364-19.525818 0-37.003636-6.772364-45.824-17.826909-8.680727-10.798545-159.255273-182.807273-245.643636-281.250909L239.755636 900.142545C228.770909 911.965091 211.805091 918.341818 191.767273 918.341818L191.767273 918.341818 191.767273 918.341818z" fill="#515151" p-id="121438"></path></svg>' },
        { id: 'home', text: '更新了状态 到家了', svg: '<svg t="1758905359962" class="icon" viewBox="0 0 1029 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="126692" width="18" height="18"><path d="M1001.423238 494.592q21.504 20.48 22.528 45.056t-16.384 40.96q-19.456 17.408-45.056 16.384t-40.96-14.336q-5.12-4.096-31.232-28.672t-62.464-58.88-77.824-73.728-78.336-74.24-63.488-60.416-33.792-31.744q-32.768-29.696-64.512-28.672t-62.464 28.672q-10.24 9.216-38.4 35.328t-65.024 60.928-77.824 72.704-75.776 70.656-59.904 55.808-30.208 27.136q-15.36 12.288-40.96 13.312t-44.032-15.36q-20.48-18.432-19.456-44.544t17.408-41.472q6.144-6.144 37.888-35.84t75.776-70.656 94.72-88.064 94.208-88.064 74.752-70.144 36.352-34.304q38.912-37.888 83.968-38.4t76.8 30.208q6.144 5.12 25.6 24.064t47.616 46.08 62.976 60.928 70.656 68.096 70.144 68.096 62.976 60.928 48.128 46.592zM447.439238 346.112q25.6-23.552 61.44-25.088t64.512 25.088q3.072 3.072 18.432 17.408l38.912 35.84q22.528 21.504 50.688 48.128t57.856 53.248q68.608 63.488 153.6 142.336l0 194.56q0 22.528-16.896 39.936t-45.568 18.432l-193.536 0 0-158.72q0-33.792-31.744-33.792l-195.584 0q-17.408 0-24.064 10.24t-6.656 23.552q0 6.144-0.512 31.232t-0.512 53.76l0 73.728-187.392 0q-29.696 0-47.104-13.312t-17.408-37.888l0-203.776q83.968-76.8 152.576-139.264 28.672-26.624 57.344-52.736t52.224-47.616 39.424-36.352 19.968-18.944z" p-id="126693" fill="#4ac9c2"></path></svg>' },
        { id: 'go', text: '更新了状态 出门了', svg: '<svg t="1758905421214" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="129001" width="18" height="18"><path d="M917.333333 938.666667h-21.333333V96a53.393333 53.393333 0 0 0-53.333333-53.333333H181.333333a53.393333 53.393333 0 0 0-53.333333 53.333333v842.666667h-21.333333a21.333333 21.333333 0 0 0 0 42.666666h810.666666a21.333333 21.333333 0 0 0 0-42.666666z m-128-384H661.333333a21.333333 21.333333 0 0 1 0-42.666667h128a21.333333 21.333333 0 0 1 0 42.666667z m21.333334 64v256a21.333333 21.333333 0 0 1-42.666667 0V618.666667a21.333333 21.333333 0 0 1 42.666667 0z m-597.333334 320V149.333333a21.333333 21.333333 0 0 1 21.333334-21.333333h554.666666a21.333333 21.333333 0 0 1 21.333334 21.333333v298.666667a21.333333 21.333333 0 0 1-42.666667 0V170.666667H256v768z" fill="#55da84" p-id="129002"></path></svg>' },
        { id: 'sleep', text: '更新了状态 准备睡觉', svg: '<svg t="1758905697696" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="149826" width="18" height="18"><path d="M416.896 64A406.698667 406.698667 0 0 0 405.333333 160.554667c0 223.850667 181.482667 405.333333 405.333334 405.333333 52.181333 0 102.058667-9.856 147.861333-27.818667C940.16 768.576 747.242667 949.888 512 949.888c-247.424 0-448-200.576-448-448C64 287.104 215.146667 107.605333 416.896 64zM832 138.666667c27.52 0 41.792 32.128 24.597333 52.48l-1.962666 2.133333-137.408 137.386667H832a32 32 0 0 1 31.850667 28.928L864 362.666667a32 32 0 0 1-28.928 31.850666L832 394.666667h-192c-27.52 0-41.792-32.128-24.597333-52.48l1.962666-2.133334 137.365334-137.386666H640a32 32 0 0 1-31.850667-28.928L608 170.666667a32 32 0 0 1 28.928-31.850667L640 138.666667h192z" fill="#fd7db4" p-id="149827"></path></svg>' }
    ];

    // 用于暂存弹窗数据的状态
    let currentStatusData = {};

    // --- 【新增】状态页专用的状态变量 ---
    let activeStatusContextMenuMsgId = null; // 正在操作的状态消息ID
    let statusMultiSelectMode = false;       // 状态页是否处于多选模式
    let selectedStatusMessageIds = new Set(); // 存储已选中的状态消息ID

    let multiSelectMode = false;
    let selectedMessageIds = new Set();
    let visibleMessageCount = 30; // 默认显示最近30条
    let activeChatId = null;
    let chats = [];
    let stickers = [];
    let state = { apiSettings: {} }; // 【【【核心新增】】】
    let stickerFileAsDataUrl = null;
    let currentOpenPanel = 'none';
    let functionsPanelState = { currentPage: 1, totalPages: 2 };
    let coupleSpaceSettings = {};
    let coupleSpaceTheme = {};
    let currentPolaroidIndex = 0;
    let fontSettings = {};
    let currentImageUploadTarget = null;
    let desktopSettings = {};
    let desktopWallpaper = '';
    let desktopIconSettings = {};
    let currentAvatarUploadTarget = null;
    const defaultIconSVGs = {};
    let currentManagingStickerPack = { chatId: null, packId: null }; // 新增：跟踪当前正在管理的表情包
    let currentStickerAddContext = 'global'; // 新增：跟踪“添加表情”弹窗的上下文

    // --- 【【【全新】】】插入消息弹窗相关变量 ---
    const insertMessageModal = document.getElementById('insert-message-modal');
    const insertModalBody = document.getElementById('insert-modal-body');
    const insertActionsContainer = document.getElementById('insert-actions-container');
    const insertPreviewContainer = document.getElementById('insert-preview-container');
    const insertModalSaveBtn = document.getElementById('insert-modal-save-btn');
    const insertModalCancelBtn = document.getElementById('insert-modal-cancel-btn');
    const insertModalCloseBtn = document.getElementById('insert-modal-close-btn');

    // ===================================================================
    // 【V1.96 新增】世界书功能相关变量
    // ===================================================================
    const worldBookScreen = document.getElementById('world-book-screen');
    const presetBottomNav = document.querySelector('.preset-bottom-nav');
    const presetPages = document.querySelectorAll('.preset-page');
    const presetPageRole = document.getElementById('preset-page-role');
    const addNewRolePresetBtn = document.getElementById('add-new-role-preset-btn');

    // 编辑角色页面
    const presetEditScreen = document.getElementById('preset-edit-screen');
    const presetEditorTitle = document.getElementById('preset-editor-title');
    const saveRolePresetBtn = document.getElementById('save-role-preset-btn');
    const presetNameContainer = document.getElementById('preset-name-input-container');
    const presetNameText = document.getElementById('preset-name-text');
    const presetContentContainer = document.getElementById('preset-content-input-container');
    const presetContentText = document.getElementById('preset-content-text');
    const presetDropdownContainer = document.querySelector('.preset-dropdown-container');
    const presetDropdownHeader = document.querySelector('.preset-dropdown-header');
    const presetDropdownLabel = document.getElementById('preset-dropdown-label');
    const presetDropdownList = document.querySelector('.preset-dropdown-list');

    // 修改禁词页面
    const presetForbiddenWordsScreen = document.getElementById('preset-forbidden-words-screen');
    const forbiddenWordsPositionSelect = document.getElementById('forbidden-words-position-select');
    const forbiddenWordsContentInput = document.getElementById('forbidden-words-content-input');
    const saveForbiddenWordsBtn = document.getElementById('save-forbidden-words-btn');

    let presets = {
        roles: [],
        forbiddenWords: { position: 'all', content: '', avatar: '' },
        // 【核心修改】清空示例数据，准备接收真实数据
        offlines: [],
        assets: {
            writingStyles: [],
            socialAssets: []
        }
    };
    let currentEditingPresetId = null; // 跟踪当前正在编辑的角色ID
    let currentEditingOfflinePresetId = null; // 跟踪当前正在编辑的预设ID

    // 【新增】跟踪素材编辑状态
    let currentEditingAsset = { type: null, id: null };
    let currentEditingSocialAssetImages = []; // 临时存储正在编辑的朋友圈素材的图片列表

    // 【全新 V1.92 性能优化】创建一个“图标配置地图”，在启动时缓存所有元素
    const iconConfigMap = {};
    // --- 【【【全新】】】转账功能核心函数 ---

    /**
     * 打开转账弹窗
     */
    function openTransferModal() {
        transferAmountInput.value = '';
        transferRemarksInput.value = '';
        closeAllPanels(); // 关闭可能打开的功能面板
        transferModal.classList.add('visible');
    }

    /**
     * 处理发送转账的逻辑
     */
    function handleSendTransfer() {
        const amountStr = transferAmountInput.value.trim();
        const amount = parseFloat(amountStr);
        const remarks = transferRemarksInput.value.trim();
        const chat = chats.find(c => c.id === activeChatId);

        if (isNaN(amount) || amount <= 0) {
            alert('请输入有效的转账金额！');
            return;
        }
        if (!chat) return;

        const message = {
            id: 'msg_' + Date.now() + Math.random(), // 确保ID绝对唯一
            role: 'user',
            type: 'transfer', // 标记为转账类型
            amount: amount.toFixed(2), // 格式化为两位小数
            remarks: remarks,
            timestamp: Date.now(),
            status: 'pending' // 添加初始状态
        };

        // 【【【核心新增：为AI注入隐藏的系统提示】】】
        const hiddenMessageForAI = {
            role: 'system',
            content: `[系统提示：用户向你发起了一笔转账，金额为 ¥${message.amount}${message.remarks ? '，备注为：' + message.remarks : ''}。请你根据我们之间的关系和当前对话情景，决定是否接受，并使用 'transfer_response' 指令回应。]`,
            timestamp: Date.now() + 1, // 确保在用户消息之后
            isHidden: true // 这个消息对用户不可见
        };

        chat.history.push(message, hiddenMessageForAI); // 同时推入两条消息
        saveChats();
        appendMessage(message, messageContainer, true);
        renderContactList();
        transferModal.classList.remove('visible');
    }

    // --- 功能函数 ---
    /**
     * 【【【全新 V3.2 修复】】】带过渡效果的隐藏函数
     * @param {HTMLElement} element - 要隐藏的元素
     * @param {string} activeClass - 控制显示的CSS类名 (例如 'visible' 或 'popup-active')
     */
    function hideWithTransition(element, activeClass) {
        if (!element) return;

        // 1. 移除激活类以启动过渡动画
        element.classList.remove(activeClass);

        // 2. 监听动画结束事件
        const onTransitionEnd = () => {
            // 3. 动画结束后，再设置 visibility: hidden
            element.style.visibility = 'hidden';
            // 4. 移除事件监听器，防止多次触发
            element.removeEventListener('transitionend', onTransitionEnd);
        };

        element.addEventListener('transitionend', onTransitionEnd);
    }
    /**
* 【【【全新 V3.9.2】】】 辅助函数：检查两个时间戳是否在同一天
* @param {number} ts1 - 时间戳1
* @param {number} ts2 - 时间戳2
* @returns {boolean}
*/
    function isSameDay(ts1, ts2) {
        const date1 = new Date(ts1);
        const date2 = new Date(ts2);
        return date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate();
    }

    /**
     * 【【【全新 V4.1 修复】】】 辅助函数：检查两个时间戳是否在同一天
     * @param {number|Date} ts1 - 时间戳1
     * @param {number|Date} ts2 - 时间戳2
     * @returns {boolean}
     */
    function isSameDay(ts1, ts2) {
        if (!ts1 || !ts2) return false;
        const date1 = new Date(ts1);
        const date2 = new Date(ts2);
        return date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate();
    }


    /**
     * 【【【全新 V4.1 最终修复】】】 专门格式化状态条时间戳的函数
     * @param {number} realTimestamp - 消息的真实时间戳
     * @param {string} customTime - 用户自定义的 "HH:MM" 格式时间
     * @returns {string} - 格式化后的完整时间字符串
     */
    function formatSystemStatusTimestamp(realTimestamp, customTime) {
        const date = new Date(realTimestamp);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        // 如果是今天，直接返回自定义时间
        if (isSameDay(date, today)) {
            return customTime;
        }
        // 如果是昨天，返回 "昨天" + 自定义时间
        else if (isSameDay(date, yesterday)) {
            return `昨天 ${customTime}`;
        }
        // 如果是一周内，返回 "星期X" + 自定义时间
        else if (today.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
            const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            return `${weekdays[date.getDay()]} ${customTime}`;
        }
        // 更早的，返回 "X月X日" + 自定义时间
        else {
            return `${date.getMonth() + 1}月${date.getDate()}日 ${customTime}`;
        }
    }
    /**
     * 【【【全新 V3.9.1】】】 格式化状态详情页的消息时间戳
     * @param {number} timestamp - 消息的时间戳
     * @returns {string} - 格式化后的时间字符串
     */
    function formatStatusTimestamp(timestamp) {
        const date = new Date(timestamp);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

        // 【【【核心修复】】】 调用我们刚刚添加的 isSameDay 工具函数进行判断
        if (isSameDay(date, today)) {
            return time; // 当天的消息，只显示 HH:MM
        } else if (isSameDay(date, yesterday)) {
            return `昨天 ${time}`;
        } else if (today.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
            const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            return `${weekdays[date.getDay()]} ${time}`;
        } else {
            return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
        }
    }
    // ===================================================================
    // 【V2.30】日期和时间格式化工具函数
    // ===================================================================
    function formatMessageTime(timestamp) {
        const date = new Date(timestamp);
        const hours = date.getHours(); // 获取24小时制的小时 (0-23)
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const period = hours >= 12 ? 'PM' : 'AM';

        // 按照您的要求 "17:21 PM" 格式
        const hours24 = String(hours).padStart(2, '0');

        return `${hours24}:${minutes} ${period}`;
    }
    /**
     * 【【【全新】】】专用于格式化日期分隔符中的时间（不带AM/PM）
     * @param {number} timestamp - 消息的时间戳
     * @returns {string} - 格式化后的 "HH:MM" 字符串
     */
    function formatDateSeparatorTimeOnly(timestamp) {
        const date = new Date(timestamp);
        const hours = String(date.getHours()).padStart(2, '0'); // 24小时制
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }
    function formatDateSeparator(timestamp) {
        const date = new Date(timestamp);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        // --- 【【【核心修改】】】 ---
        // 调用我们刚刚创建的新函数，这个函数不带 AM/PM
        const time = formatDateSeparatorTimeOnly(timestamp);

        // Helper function to check if two dates are on the same day
        const isSameDayCheck = (d1, d2) =>
            d1.getFullYear() === d2.getFullYear() &&
            d1.getMonth() === d2.getMonth() &&
            d1.getDate() === d2.getDate();

        if (isSameDayCheck(date, today)) {
            return time; // 当天的消息，只返回时间
        } else if (isSameDayCheck(date, yesterday)) {
            return `昨天 ${time}`;
        } else if (today.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
            const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
            return `${weekdays[date.getDay()]} ${time}`;
        } else {
            return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
        }
    }


    // ===================================================================
    // 【全新 V1.73】情侣空间页面切换和主题功能函数
    // ===================================================================

    /**
     * 切换情侣空间内部的子页面
     * @param {string} pageNumber - 要切换到的页面编号 (1-4)
     */
    function switchCoupleContentPage(pageNumber) {
        // 1. 切换页面的显示
        coupleContentPages.forEach(page => {
            page.classList.remove('active');
            if (page.id === `couple-page-${pageNumber}`) {
                page.classList.add('active');
            }
        });

        // 2. 移动滑块
        const pageIndex = parseInt(pageNumber, 10) - 1;
        const sliderPosition = 12.5 + (pageIndex * 25);
        navSlider.style.left = `${sliderPosition}%`;

        // 3. 【【【全新 V2.62】】】更新顶栏标题和右上角按钮
        const mainHeader = document.querySelector('#couple-space-screen .couple-header');
        const headerTitle = mainHeader.querySelector('h1');
        const moreOptionsBtn = mainHeader.querySelector('.header-icon-right');

        const titles = ['情侣空间', '消息', '心情日记', '爱情运势'];
        headerTitle.textContent = titles[pageIndex];

        // 只有第一页(情侣空间)显示右上角按钮
        if (pageNumber == '1') {
            moreOptionsBtn.style.visibility = 'visible';
        } else {
            moreOptionsBtn.style.visibility = 'hidden';
        }
    }

    /**
* 【【【全新 V4.3】】】保存“Me”页面的数据到 IndexedDB
*/
    async function saveMePageData() {
        try {
            await db.set('mePageData', mePageData);
        } catch (error) {
            console.error("Failed to save mePageData to IndexedDB:", error);
            alert("保存个人主页数据失败！");
        }
    }

    /**
     * 【【【全新 V4.3】】】从 IndexedDB 加载“Me”页面的数据
     */
    async function loadMePageData() {
        const savedData = await db.get('mePageData') || {};
        // 设置默认值，防止第一次加载时出错
        mePageData = {
            avatar: savedData.avatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp',
            name: savedData.name || 'Name',
            signature: savedData.signature || '点我输入自定义个性签名...'
        };
    }

    /**
     * 【【【全新 V4.3】】】将 mePageData 对象中的数据显示在界面上
     */
    function applyMePageData() {
        mePageAvatar.src = mePageData.avatar;
        mePageName.textContent = mePageData.name;
        mePageSignature.textContent = mePageData.signature;
    }

    /**
     * 【V1.81 最终修复版】保存情侣空间主题设置 (使用 IndexedDB)
     */
    async function saveCoupleThemeSettings() {
        try {
            await db.set('coupleSpaceTheme', coupleSpaceTheme); // 从 localStorage 改为 IndexedDB
        } catch (error) {
            console.error("Failed to save couple theme to IndexedDB:", error);
            alert("保存主题数据失败，可能是存储空间问题。");
        }
    }

    /**
     * 【V1.81 最终修复版】加载并应用情侣空间主题设置 (使用 IndexedDB)
     */
    async function loadAndApplyCoupleTheme() {
        // 异步地从 IndexedDB 获取数据，如果不存在则返回一个空对象
        const savedTheme = await db.get('coupleSpaceTheme') || {};

        coupleSpaceTheme = {
            background: savedTheme.background || '',
            polaroids: savedTheme.polaroids || ['', '', '', '']
        };

        // 【【【核心修改开始】】】
        const backgroundOverlay = document.getElementById('couple-space-background-overlay');

        // 应用背景
        if (coupleSpaceTheme.background && backgroundOverlay) {
            // 1. 给背景图层设置图片
            backgroundOverlay.style.backgroundImage = `url(${coupleSpaceTheme.background})`;
            // 2. 给主屏幕添加class，让背景图层显示出来
            coupleSpaceScreen.classList.add('has-custom-bg');
        } else {
            // 1. 如果没有背景图，清空背景图层的图片
            if (backgroundOverlay) {
                backgroundOverlay.style.backgroundImage = 'none';
            }
            // 2. 移除class，让背景图层隐藏
            coupleSpaceScreen.classList.remove('has-custom-bg');
        }
        // 【【【核心修改结束】】】

        // 应用拍立得照片 (这部分逻辑保持不变)
        polaroidItems.forEach((item, index) => {
            const photoDiv = item.querySelector('.polaroid-photo');
            const imageUrl = coupleSpaceTheme.polaroids[index];
            if (imageUrl && photoDiv) {
                photoDiv.style.backgroundImage = `url(${imageUrl})`;
                item.classList.add('is-customized');
            } else if (photoDiv) {
                photoDiv.style.backgroundImage = 'none';
                item.classList.remove('is-customized');
            }
        });

        // 更新删除图标的可见性 (这部分逻辑保持不变)
        updateDeleteIconsVisibility();
    }

    /**
     * 处理情侣空间背景上传
     */
    function handleCoupleBgUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            coupleSpaceTheme.background = imageUrl;
            saveCoupleThemeSettings();
            loadAndApplyCoupleTheme(); // 立即应用
        };
        reader.readAsDataURL(file);
        // 使用 desktopFileInput，因为它已经是全局的
        desktopFileInput.value = '';
    }

    /**
     * 【全新】处理拍立得照片上传
     */
    function handlePolaroidPhotoUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            // 根据之前记录的索引，保存到对应的位置
            coupleSpaceTheme.polaroids[currentPolaroidIndex] = imageUrl;
            saveCoupleThemeSettings();
            loadAndApplyCoupleTheme(); // 立即应用
        };
        reader.readAsDataURL(file);
        desktopFileInput.value = '';
    }
    /**
* 【全新 V1.92 最终修复】专门处理应用图标上传的函数
*/
    function handleAppIconUpload(event) {
        const file = event.target.files[0];
        // 确保有文件，且上传目标是图标
        if (!file || !currentImageUploadTarget || !currentImageUploadTarget.startsWith('icon-')) return;

        // 从上传目标中解析出图标的key，例如 'icon-chat' -> 'chat'
        const iconKey = currentImageUploadTarget.replace('icon-', '');

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            // 确保该图标的设置对象存在
            if (!desktopIconSettings[iconKey]) {
                desktopIconSettings[iconKey] = {};
            }
            // 保存图片数据
            desktopIconSettings[iconKey].imageUrl = imageUrl;
            // 【核心】上传图片后，清空URL，因为图片的优先级更高
            desktopIconSettings[iconKey].url = '';

            // 并且清空界面上URL输入框的内容
            const urlInput = appIconSettingsContainer.querySelector(`.app-icon-url-input[data-icon-key="${iconKey}"]`);
            if (urlInput) urlInput.value = '';

            saveDesktopSettings(); // 保存到IndexedDB
            applyDesktopIconSettings(); // 立即刷新图标显示
        };
        reader.readAsDataURL(file);
    }
    // ===================================================================
    // 【全新 V1.65】情侣空间核心功能函数
    // ===================================================================

    /**
     * 保存情侣空间设置到 localStorage
     */
    async function saveCoupleSpaceSettings() {
        await db.set('coupleSpaceSettings', coupleSpaceSettings);
        // 【新增】同时保存状态页的消息记录
        await db.set('coupleStatusMessages', coupleStatusMessages);
    }

    /**
     * 从 localStorage 加载情侣空间设置并应用
     */
    async function loadCoupleSpaceSettings() {
        const savedSettings = await db.get('coupleSpaceSettings') || {};
        const savedStatusMessages = await db.get('coupleStatusMessages') || {};

        coupleSpaceSettings = {
            myAvatar: savedSettings.myAvatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp',
            partnerChatId: savedSettings.partnerChatId || null,
            // 【新增】绑定日期
            bindingDate: savedSettings.bindingDate || null
        };
        coupleStatusMessages = savedStatusMessages;

        // 应用加载的头像
        myAvatarImg.src = coupleSpaceSettings.myAvatar;

        // 【新增】加载后立刻更新UI
        updateCoupleSpaceUI();
    }

    /**
     * 处理情侣空间内，我方头像的上传逻辑
     */
    function handleCoupleAvatarUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            coupleSpaceSettings.myAvatar = imageUrl;
            myAvatarImg.src = imageUrl;
            saveCoupleSpaceSettings();
        };
        reader.readAsDataURL(file);
        coupleAvatarUploadInput.value = ''; // 清空以便下次选择
    }

    /**
     * 渲染邀请好友列表
     */
    function renderCoupleInviteList() {
        coupleInviteListContainer.innerHTML = ''; // 清空
        if (chats.length === 0) {
            coupleInviteListContainer.innerHTML = `<p style="text-align:center; color:#888; margin-top: 40px;">你还没有创建任何联系人</p >`;
            return;
        }

        chats.forEach(chat => {
            const item = document.createElement('div');
            item.className = 'couple-invite-item';
            item.addEventListener('click', () => handleInviteContact(chat.id, chat.name));

            const avatarUrl = chat.settings?.aiAvatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';

            item.innerHTML = `
                        <img src="${avatarUrl}" class="couple-invite-avatar">
                        <span class="couple-invite-name">${chat.name}</span>
                    `;
            coupleInviteListContainer.appendChild(item);
        });
    }

    /**
     * 处理点击邀请好友的逻辑
     */
    function handleInviteContact(chatId, chatName) {
        const existingPartnerId = coupleSpaceSettings.partnerChatId;
        if (existingPartnerId) {
            const existingPartner = chats.find(c => c.id === existingPartnerId);
            const existingPartnerName = existingPartner ? existingPartner.name : '当前伴侣';
            showConfirmationModal(`你已与 ${existingPartnerName} 绑定关系，若与 ${chatName} 建立新关系，旧关系将自动解除。确定要继续吗？`, () => {
                // 解除旧关系
                const oldChat = chats.find(c => c.id === existingPartnerId);
                if (oldChat) {
                    oldChat.history.push({
                        id: 'msg_' + Date.now() + Math.random(),
                        role: 'system',
                        type: 'couple_status',
                        statusType: 'system-ends-relationship-due-to-new', // 系统消息
                        isActionable: false,
                        timestamp: Date.now()
                    });
                }
                // 发送新邀请
                sendInvite(chatId, chatName);
            });
        } else {
            showConfirmationModal(`情侣空间目前只可绑定一人，确定要与 ${chatName} 建立情侣关系吗？`, () => {
                sendInvite(chatId, chatName);
            });
        }
    }

    /**
     * 显示并自动隐藏“发送成功”提示
     */
    function showSuccessToast() {
        successToast.classList.add('show');
        setTimeout(() => {
            successToast.classList.remove('show');
        }, 2000); // 2秒后自动消失
    }


    // ===================================================================
    // ===================================================================
    // 【全新 V1.69】邀请弹窗交互函数
    // ===================================================================

    /**
     * 打开邀请弹窗
     * @param {string} messageId - 被点击的邀请消息的ID
     */
    function openInviteModal(messageId) {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        const defaultAvatar = 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';
        inviteModalAiAvatar.src = chat.settings.aiAvatar || defaultAvatar;
        inviteModalUserAvatar.src = chat.settings.userAvatar || defaultAvatar;

        // 为了确保每次事件都是全新的，我们重新获取按钮元素
        const currentAcceptBtn = document.getElementById('invite-accept-btn');
        const currentRejectBtn = document.getElementById('invite-reject-btn');
        const currentCloseBtn = document.querySelector('.invite-modal-close-btn');

        // 使用克隆节点技巧，彻底清除旧的事件监听器
        const newAcceptBtn = currentAcceptBtn.cloneNode(true);
        currentAcceptBtn.parentNode.replaceChild(newAcceptBtn, currentAcceptBtn);

        const newRejectBtn = currentRejectBtn.cloneNode(true);
        currentRejectBtn.parentNode.replaceChild(newRejectBtn, currentRejectBtn);

        const newCloseBtn = currentCloseBtn.cloneNode(true);
        currentCloseBtn.parentNode.replaceChild(newCloseBtn, currentCloseBtn);

        // --- 为全新的按钮绑定事件 ---

        // “我愿意”按钮：调用处理函数，并传入 'accept'
        newAcceptBtn.addEventListener('click', function handler() {
            respondToInvite(messageId, 'accept');
            // 处理后移除自身监听，防止重复触发
            newAcceptBtn.removeEventListener('click', handler);
        });

        // “残忍拒绝”按钮：调用处理函数，并传入 'reject'
        newRejectBtn.addEventListener('click', function handler() {
            respondToInvite(messageId, 'reject');
            newRejectBtn.removeEventListener('click', handler);
        });

        // “关闭”按钮：只负责关闭弹窗，不执行任何其他逻辑
        newCloseBtn.addEventListener('click', () => {
            inviteModal.classList.remove('visible');
        });

        inviteModal.classList.add('visible');

        // 每次打开都重新触发动画
        inviteAnimationContainer.classList.remove('animate');
        // 强制浏览器重绘以重启CSS动画
        void inviteAnimationContainer.offsetWidth;
        inviteAnimationContainer.classList.add('animate');
    }

    /**
     * 响应邀请
     * @param {string} originalMessageId - 原始邀请消息的ID
     * @param {'accept' | 'reject'} response - 用户的响应
     */
    function respondToInvite(originalMessageId, response) {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) {
            inviteModal.classList.remove('visible');
            return;
        }
        const originalMessage = chat.history.find(msg => msg.id === originalMessageId);

        if (originalMessage && originalMessage.isActionable) {
            originalMessage.isActionable = false;

            const responseStatus = response === 'accept' ? 'user-accepts-invite' : 'user-rejects-invite';
            const responseMessage = {
                id: 'msg_' + Date.now() + Math.random(),
                role: 'user',
                type: 'couple_status',
                statusType: responseStatus,
                isActionable: false,
                timestamp: Date.now()
            };
            chat.history.push(responseMessage);

            // 【【【核心新增 V2.62】】】
            if (response === 'accept') {
                // 如果接受了，就更新情侣空间状态
                coupleSpaceSettings.partnerChatId = chat.id;
                coupleSpaceSettings.bindingDate = Date.now();
                updateCoupleSpaceUI(); // 立刻更新UI
            }

            saveChats();
            saveCoupleSpaceSettings(); // 保存情侣空间的新状态
            renderMessages();
            renderContactList();
            inviteModal.classList.remove('visible');
        }
    }

    // ===================================================================
    // 【【【全新 V2.62】】】情侣空间核心逻辑函数
    // ===================================================================

    /**
     * 发送邀请的核心逻辑
     */
    function sendInvite(chatId, chatName) {
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            const inviteMessage = {
                id: 'msg_' + Date.now() + Math.random(),
                role: 'user', type: 'couple_status',
                statusType: 'user-sends-invite',
                isActionable: false, timestamp: Date.now()
            };
            const myName = chat.settings.userName || '我';
            const hiddenMessageForAI = {
                role: 'system',
                content: `[系统提示：用户'${myName}'向你发起了情侣关系邀请。请你根据自己的人设和当前对话氛围，决策是否同意，并使用 'couple_request_response' 指令，设置 'decision' 为 'accept' 或 'reject' 来回应。]`,
                timestamp: Date.now() + 1, isHidden: true
            };
            chat.history.push(inviteMessage, hiddenMessageForAI);
            saveChats();
            renderContactList();
            showSuccessToast();
            activeChatId = chatId;
            chatContactName.textContent = chat.settings.aiName || chat.name;
            renderMessages();
            applyChatStyles();
            showScreen('chat-interface-screen');
        }
    }

    /**
     * 根据绑定状态，更新整个情侣空间的UI
     */
    function updateCoupleSpaceUI() {
        const promptText = coupleSpaceScreen.querySelector('.couple-space-prompt');
        const partnerId = coupleSpaceSettings.partnerChatId;

        const lockedPrompts = document.querySelectorAll('.couple-feature-locked-prompt');
        const messageListPage = document.querySelector('#couple-page-2 .couple-message-list');

        // 【【【全新】】】 获取新的天数显示元素
        const daysNumberSpan = document.querySelector('.couple-days-counter-bound .days-number');

        if (partnerId) { // --- 已绑定状态 ---
            coupleSpaceScreen.classList.add('couple-space-bound');

            const partnerChat = chats.find(c => c.id === partnerId);
            if (!partnerChat) {
                handleBreakup();
                return;
            }

            const bindingDate = new Date(coupleSpaceSettings.bindingDate);
            const today = new Date();
            const timeDiff = today.getTime() - bindingDate.getTime();
            const days = Math.max(1, Math.ceil(timeDiff / (1000 * 3600 * 24)));

            // 【【【核心修改】】】 将计算出的天数填充到新的span中
            if (daysNumberSpan) {
                daysNumberSpan.textContent = String(days).padStart(3, '0');
            }
            // 保留对旧元素的更新，以防万一，虽然它现在被隐藏了
            promptText.innerHTML = `我们在一起<br>${String(days).padStart(3, '0')}天`;

            partnerAvatarImg.src = partnerChat.settings.aiAvatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';
            partnerAvatarImg.style.display = 'block';
            partnerAvatarPlaceholder.style.display = 'none';

            partnerAvatarWrapper.removeAttribute('data-target');
            partnerAvatarWrapper.style.cursor = 'pointer';

            lockedPrompts.forEach(p => p.style.display = 'none');
            messageListPage.style.display = 'flex';

        } else { // --- 未绑定状态 ---
            coupleSpaceScreen.classList.remove('couple-space-bound');

            promptText.innerHTML = '添加另一半解锁更多功能';

            partnerAvatarImg.style.display = 'none';
            partnerAvatarPlaceholder.style.display = 'flex';

            partnerAvatarWrapper.setAttribute('data-target', 'couple-space-invite-screen');

            partnerAvatarWrapper.classList.remove('popup-active');

            lockedPrompts.forEach(p => p.style.display = 'block');
            messageListPage.style.display = 'none';
        }
    }

    /**
     * 处理解除关系的核心逻辑
     */
    function handleBreakup() {
        const partnerId = coupleSpaceSettings.partnerChatId;
        const chat = chats.find(c => c.id === partnerId);

        // （可选）向对方发送一条系统解绑消息
        if (chat) {
            chat.history.push({
                id: 'msg_' + Date.now() + Math.random(),
                role: 'system', // 注意：由系统发出
                type: 'couple_status',
                statusType: 'user-ends-relationship', // 【核心修改】使用新的状态类型
                isActionable: false,
                timestamp: Date.now()
            });
            saveChats();
            // 如果当前正在看这个聊天，就刷新一下
            if (activeChatId === partnerId) renderMessages();
            renderContactList();
        }

        // 清空情侣空间设置
        coupleSpaceSettings.partnerChatId = null;
        coupleSpaceSettings.bindingDate = null;

        // 清空对应的状态页消息历史
        if (partnerId && coupleStatusMessages[partnerId]) {
            delete coupleStatusMessages[partnerId];
        }

        saveCoupleSpaceSettings(); // 保存更新
        updateCoupleSpaceUI(); // 更新UI到未绑定状态

        // 关闭所有弹窗
        breakupConfirmModal.classList.remove('visible');
        partnerAvatarWrapper.classList.remove('popup-active');
    }

    // ===================================================================
    // 【【【全新 V2.62】】】状态页核心逻辑函数
    // ===================================================================

    /**
     * 打开状态详情页
     */
    function openStatusDetailScreen() {
        // 【【【核心新增 V3.9.5】】】进入页面时，确保快捷删除模式是关闭的
        coupleStatusDetailScreen.classList.remove('direct-delete-mode');

        const partnerId = coupleSpaceSettings.partnerChatId;
        const partnerChat = chats.find(c => c.id === partnerId);
        if (!partnerChat) return;
        // 更新顶栏标题
        coupleStatusHeaderTitle.textContent = `${partnerChat.name}`;
        // 渲染消息
        renderStatusMessages();
        showScreen('couple-status-detail-screen');

        // 【【【核心新增 V3.9.3】】】进入页面时，强制滚动到底部
        setTimeout(() => {
            coupleStatusMessageContainer.scrollTop = coupleStatusMessageContainer.scrollHeight;
        }, 50); // 使用微小延迟确保渲染完成后再滚动
    }

    /**
     * 渲染状态页的消息 (V3.9.2 隔天加载最终版)
     * @param {boolean} showAll - 是否强制显示所有消息
     */
    function renderStatusMessages(showAll = false) {
        coupleStatusMessageContainer.innerHTML = '';
        const partnerId = coupleSpaceSettings.partnerChatId;
        if (!partnerId || !coupleStatusMessages[partnerId] || coupleStatusMessages[partnerId].length === 0) return;

        const allMessages = coupleStatusMessages[partnerId];
        let messagesToShow = allMessages;

        // 1. 检查是否存在历史消息 (即非今天的消息)
        const todayTimestamp = Date.now();
        const hasHistory = allMessages.some(msg => !isSameDay(msg.timestamp, todayTimestamp));

        // 2. 如果存在历史消息，并且我们不是在“显示全部”模式下
        if (hasHistory && !showAll) {
            // 2.1 创建并显示“查看历史”按钮
            const historyLoader = document.createElement('div');
            historyLoader.className = 'status-history-loader';
            historyLoader.innerHTML = `<svg t="1758949093118" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="159173" width="14" height="14"><path d="M147.012 430.89c-44.791 0-81.109 36.305-81.109 81.11 0 44.779 36.317 81.108 81.109 81.108 44.792 0 81.109-36.33 81.109-81.108 0-44.805-36.316-81.11-81.11-81.11z m364.987 0c-44.79 0-81.108 36.305-81.108 81.11 0 44.779 36.316 81.108 81.108 81.108 44.793 0 81.11-36.33 81.11-81.108 0-44.805-36.317-81.11-81.11-81.11z m364.988 0c-44.79 0-81.108 36.305-81.108 81.11 0 44.779 36.316 81.108 81.108 81.108s81.109-36.33 81.109-81.108c-0.002-44.805-36.318-81.11-81.109-81.11z" p-id="159174" fill="#515151"></path></svg>`;
            historyLoader.onclick = () => {
                renderStatusMessages(true); // 点击后，用“显示全部”模式重新渲染
            };
            coupleStatusMessageContainer.appendChild(historyLoader);

            // 2.2 筛选出今天要显示的消息
            messagesToShow = allMessages.filter(msg => isSameDay(msg.timestamp, todayTimestamp));
        }

        // 3. 遍历并渲染需要显示的消息
        messagesToShow.forEach(msg => {
            // --- 渲染系统状态条 ---
            if (msg.type === 'system_status') {
                const wrapper = document.createElement('div');
                wrapper.className = 'system-status-wrapper';
                wrapper.dataset.messageId = msg.id;

                const timestamp = document.createElement('div');
                timestamp.className = 'system-status-timestamp';
                // 【【【核心修复】】】: 调用我们为状态条专门创建的新函数
                timestamp.textContent = formatSystemStatusTimestamp(msg.timestamp, msg.customTime);

                const bubble = document.createElement('div');
                bubble.className = 'system-status-bubble';
                bubble.innerHTML = `
                            <div class="system-status-icon">${msg.iconSvg}</div>
                            <div class="system-status-content">${msg.subjectName} ${msg.content}</div>
                        `;

                const deleteIcon = document.createElement('div');
                deleteIcon.className = 'status-direct-delete-icon';
                deleteIcon.dataset.messageId = msg.id;
                deleteIcon.innerHTML = `<svg t="1758950887117" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="173024" width="14" height="14"><path d="M801.856 734.016 579.904 512l222.016-222.016c18.816-18.816 18.88-49.152 0.064-67.968-18.752-18.752-49.216-18.752-67.904 0L512 444.032 289.92 222.016c-18.688-18.752-49.088-18.752-67.904 0C203.328 240.768 203.328 271.232 222.144 290.048L444.096 512l-222.016 221.952c-18.816 18.752-18.816 49.152-0.064 67.968C231.424 811.392 243.84 816 256 816s24.576-4.608 33.92-14.016L512 579.968l222.08 222.016c9.408 9.344 21.696 14.016 33.92 14.016 12.288 0 24.576-4.608 33.92-14.016C820.672 783.104 820.736 752.768 801.856 734.016z" p-id="173025" fill="#2d2d2d"></path></svg>`;

                bubble.appendChild(deleteIcon);
                wrapper.appendChild(timestamp);
                wrapper.appendChild(bubble);
                coupleStatusMessageContainer.appendChild(wrapper);

            }
            // --- 渲染普通聊天气泡 ---
            else {
                const wrapper = document.createElement('div');
                wrapper.className = `status-message-wrapper ${msg.role}`;
                wrapper.dataset.messageId = msg.id;

                const bubble = document.createElement('div');
                bubble.className = `status-message-bubble ${msg.role}`;
                bubble.textContent = msg.content;

                const timestamp = document.createElement('span');
                timestamp.className = 'status-message-timestamp';
                // 【【【核心修改点 2】】】: 这里强制使用只显示时间的旧函数
                timestamp.textContent = formatMessageTime(msg.timestamp);

                const checkmark = document.createElement('div');
                checkmark.className = 'status-selection-checkmark';
                checkmark.innerHTML = `<svg t="1758555701217" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="29525" width="9.2" height="9.2"><path d="M14.336 522.24c-4.096-4.096-4.096-12.288-2.048-16.384L61.44 438.272c4.096-4.096 10.24-6.144 14.336-2.048l280.576 215.04c10.24 6.144 24.576 6.144 32.768 0L948.224 174.08c4.096-4.096 12.288-4.096 16.384 0l47.104 47.104c4.096 4.096 4.096 10.24 0 14.336L389.12 845.824c-8.192 8.192-22.528 8.192-30.72 0L14.336 522.24z m0 0" p-id="29526" fill="#ffffff"></path></svg>`;

                wrapper.appendChild(bubble);
                wrapper.appendChild(timestamp);
                wrapper.appendChild(checkmark);
                coupleStatusMessageContainer.appendChild(wrapper);
            }
        });
    }

    /**
     * 在状态页发送消息
     */
    function sendStatusMessage() {
        const text = statusMessageInput.value.trim();
        const partnerId = coupleSpaceSettings.partnerChatId;
        if (!text || !partnerId) return;

        // 【【【核心修改 V3.9.4：滚动优化】】】
        // 1. 在重新渲染前，检查当前是否已经滚动到底部
        const wasScrolledToBottom = coupleStatusMessageContainer.scrollHeight - coupleStatusMessageContainer.clientHeight <= coupleStatusMessageContainer.scrollTop + 1;

        // 确保该伴侣的消息历史数组存在
        if (!coupleStatusMessages[partnerId]) {
            coupleStatusMessages[partnerId] = [];
        }

        const newMessage = {
            id: 'status_' + Date.now() + Math.random(),
            role: 'user',
            content: text,
            timestamp: Date.now()
        };

        coupleStatusMessages[partnerId].push(newMessage);
        saveCoupleSpaceSettings();
        renderStatusMessages(true);

        statusMessageInput.value = '';
        statusMessageInput.style.height = 'auto';
        statusMessageInput.focus();

        // 2. 如果之前就在底部，则立即滚动到新的底部，消除闪烁
        if (wasScrolledToBottom) {
            coupleStatusMessageContainer.scrollTop = coupleStatusMessageContainer.scrollHeight;
        }
    }
    // ===================================================================
    // 【【【全新】】】情侣空间新UI交互功能
    // ===================================================================
    const coupleCustomBgArea = document.getElementById('couple-custom-background-area');
    const coupleCustomBgUploadInput = document.getElementById('couple-custom-bg-upload-input');

    // 1. 点击自定义背景区域时，触发隐藏的文件上传工具
    coupleCustomBgArea.addEventListener('click', () => {
        coupleCustomBgUploadInput.click();
    });

    // 2. 当用户选择了文件后，进行处理
    coupleCustomBgUploadInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            // 【重要】将图片数据保存到专门为这个背景区准备的设置中
            if (!coupleSpaceSettings.customBackground) {
                coupleSpaceSettings.customBackground = {};
            }
            coupleSpaceSettings.customBackground.image = imageUrl;

            // 保存设置并立即应用
            saveCoupleSpaceSettings();
            applyCoupleCustomBackground(); // 调用一个新函数来应用背景
        };
        reader.readAsDataURL(file);
        coupleCustomBgUploadInput.value = ''; // 清空，以便下次上传
    });

    // 3. 应用自定义背景的函数
    function applyCoupleCustomBackground() {
        if (coupleSpaceSettings.customBackground && coupleSpaceSettings.customBackground.image) {
            coupleCustomBgArea.style.backgroundImage = `url(${coupleSpaceSettings.customBackground.image})`;
        } else {
            coupleCustomBgArea.style.backgroundImage = 'none';
            coupleCustomBgArea.style.backgroundColor = '#fcfcfc'; // 恢复初始颜色
        }
    }

    // 4. 在加载总设置时，也加载并应用这个背景
    async function loadCoupleSpaceSettings() {
        const savedSettings = await db.get('coupleSpaceSettings') || {};
        const savedStatusMessages = await db.get('coupleStatusMessages') || {};

        coupleSpaceSettings = {
            myAvatar: savedSettings.myAvatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp',
            partnerChatId: savedSettings.partnerChatId || null,
            bindingDate: savedSettings.bindingDate || null,
            customBackground: savedSettings.customBackground || { image: '' },
            statuses: savedSettings.statuses || [] // 【【【全新】】】 加载动态列表数据
        };
        coupleStatusMessages = savedStatusMessages;

        myAvatarImg.src = coupleSpaceSettings.myAvatar;

        // 【新增】加载后立即应用自定义背景
        applyCoupleCustomBackground();
        updateCoupleSpaceUI();
    }

    // ===================================================================
    // 【【【全新 V2.62】】】状态详情页消息交互核心功能
    // ===================================================================

    // --- 【新增】状态详情页消息交互核心功能 ---

    /**
     * 打开状态消息的交互小卡片 (V3.2 修复版)
     * @param {HTMLElement} messageBubble - 被点击的气泡元素
     * @param {string} msgId - 被点击的消息ID
     */
    function openStatusContextMenu(messageBubble, msgId) {
        activeStatusContextMenuMsgId = msgId;
        if (!messageBubble) return;

        // --- 步骤1：获取所有必要的元素和它们的尺寸/位置 ---
        const phoneWrapper = document.getElementById('phone-wrapper');
        const statusCard = document.getElementById('status-message-context-card');

        // 精确测量菜单尺寸
        statusCard.style.visibility = 'hidden';
        statusCard.style.display = 'flex';
        const cardRect = statusCard.getBoundingClientRect();
        const cardWidth = cardRect.width;
        const cardHeight = cardRect.height;
        statusCard.style.display = '';
        statusCard.style.visibility = '';

        // 获取气泡和手机框的位置信息
        const bubbleRect = messageBubble.getBoundingClientRect();
        const wrapperRect = phoneWrapper.getBoundingClientRect();
        const wrapper = messageBubble.closest('.status-message-wrapper');

        // --- 步骤2：【【【核心】】】计算缩放比例 ---
        // 用 "渲染后的宽度" 除以 "布局时的宽度" 来得到准确的缩放比例
        // 这样做的好处是无论CSS怎么改，我们总能得到正确的值
        const scale = wrapperRect.width / phoneWrapper.offsetWidth;

        // --- 步骤3：【【【核心】】】坐标换算 ---
        // a. 计算气泡中心点相对于“缩小后”的手机框左上角的位置
        const scaledBubbleCenterX = bubbleRect.left + bubbleRect.width / 2 - wrapperRect.left;
        const scaledBubbleCenterY = bubbleRect.top + bubbleRect.height / 2 - wrapperRect.top;

        // b. 用缩放比例，将这个相对位置“还原”成“正常大小”时的位置
        const unscaledBubbleCenterX = scaledBubbleCenterX / scale;
        const unscaledBubbleCenterY = scaledBubbleCenterY / scale;

        // c. 计算菜单最终在“正常大小的世界”里的绝对位置
        // 最终位置 = 手机框的左上角位置 + 气泡在手机框内的“正常大小”位置 - 菜单自身尺寸的一半
        let topPosition = window.scrollY + wrapperRect.top + unscaledBubbleCenterY - (cardHeight / 2);
        let leftPosition;

        // --- 步骤4：根据气泡左右位置，决定菜单的最终水平位置和动画起点 ---
        if (wrapper.classList.contains('user')) { // 用户消息在右边
            const unscaledBubbleLeft = (bubbleRect.left - wrapperRect.left) / scale;
            leftPosition = window.scrollX + wrapperRect.left + unscaledBubbleLeft - cardWidth - 52; // 10px 间隙
            statusCard.style.transformOrigin = 'center right';
        } else { // AI消息在左边
            const unscaledBubbleRight = (bubbleRect.right - wrapperRect.left) / scale;
            leftPosition = window.scrollX + wrapperRect.left + unscaledBubbleRight + 52; // 10px 间隙
            statusCard.style.transformOrigin = 'center left';
        }

        // --- 步骤5：边界检查 (这段逻辑依然有用，保持不变) ---
        const phoneScreenRect = document.getElementById('phone-screen').getBoundingClientRect();
        const scrollCorrectedTop = window.scrollY + phoneScreenRect.top;
        const scrollCorrectedBottom = window.scrollY + phoneScreenRect.bottom;
        const scrollCorrectedLeft = window.scrollX + phoneScreenRect.left;
        const scrollCorrectedRight = window.scrollX + phoneScreenRect.right;

        if (topPosition < scrollCorrectedTop + 4) topPosition = scrollCorrectedTop + 4;
        if (topPosition + cardHeight > scrollCorrectedBottom - 4) topPosition = scrollCorrectedBottom - cardHeight - 4;
        if (leftPosition < scrollCorrectedLeft + 4) leftPosition = scrollCorrectedLeft + 4;
        if (leftPosition + cardWidth > scrollCorrectedRight - 4) leftPosition = scrollCorrectedRight - cardWidth - 4;

        // --- 步骤6：应用样式并显示 (保持不变) ---
        statusCard.style.top = `${topPosition}px`;
        statusCard.style.left = `${leftPosition}px`;

        // 【【【核心修改】】】在播放动画前，先取消 hidden 状态
        statusCard.style.visibility = 'visible';

        setTimeout(() => {
            statusCard.classList.add('visible');
        }, 10);
    }

    /**
     * 处理状态消息的原地编辑
     */
    function handleStatusEdit() {
        const messageWrapper = document.querySelector(`.status-message-wrapper[data-message-id="${activeStatusContextMenuMsgId}"]`);
        const messageBubble = messageWrapper ? messageWrapper.querySelector('.status-message-bubble') : null;
        if (!messageBubble || messageBubble.isEditing) return;

        const partnerId = coupleSpaceSettings.partnerChatId;
        const chatMessages = coupleStatusMessages[partnerId];
        const msg = chatMessages.find(m => m.id === activeStatusContextMenuMsgId);

        if (!msg) return;

        messageBubble.isEditing = true;
        messageBubble.setAttribute('contenteditable', 'true');

        setTimeout(() => {
            messageBubble.focus();
            const range = document.createRange();
            const sel = window.getSelection();
            if (messageBubble.childNodes.length > 0) {
                range.selectNodeContents(messageBubble);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }, 50);

        const saveEdit = () => {
            const newText = messageBubble.textContent.trim();
            messageBubble.removeAttribute('contenteditable');
            delete messageBubble.isEditing;
            messageBubble.removeEventListener('blur', saveEdit);

            if (newText !== msg.content) {
                if (newText) {
                    msg.content = newText;
                } else { // 如果编辑后内容为空，则删除该消息
                    const msgIndex = chatMessages.findIndex(m => m.id === activeStatusContextMenuMsgId);
                    if (msgIndex > -1) {
                        chatMessages.splice(msgIndex, 1);
                    }
                }
                saveCoupleSpaceSettings();
                renderStatusMessages();
            }
        };

        messageBubble.addEventListener('blur', saveEdit, { once: true });
        messageBubble.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                messageBubble.blur();
            }
        });
    }

    /**
     * 进入状态页的多选模式
     */
    function enterStatusMultiSelectMode() {
        // 【【【核心新增 V3.9.5】】】进入多选模式时，强制关闭快捷删除模式
        coupleStatusDetailScreen.classList.remove('direct-delete-mode');

        statusMultiSelectMode = true;
        coupleStatusDetailScreen.classList.add('multi-select-mode');
        updateStatusMultiSelectCounter();
    }

    /**
     * 退出状态页的多选模式
     */
    function exitStatusMultiSelectMode() {
        statusMultiSelectMode = false;
        coupleStatusDetailScreen.classList.remove('multi-select-mode');
        coupleStatusMessageContainer.querySelectorAll('.status-message-wrapper.selected').forEach(el => {
            el.classList.remove('selected');
        });
        selectedStatusMessageIds.clear();
    }

    /**
     * 切换单条状态消息的选中状态
     */
    function toggleStatusSelection(msgId, messageWrapper) {
        if (selectedStatusMessageIds.has(msgId)) {
            selectedStatusMessageIds.delete(msgId);
            messageWrapper.classList.remove('selected');
        } else {
            selectedStatusMessageIds.add(msgId);
            messageWrapper.classList.add('selected');
        }
        updateStatusMultiSelectCounter();
    }

    /**
     * 更新状态页多选模式的顶部计数器
     */
    function updateStatusMultiSelectCounter() {
        const count = selectedStatusMessageIds.size;
        if (count === 0) {
            statusMultiSelectCounter.textContent = '请选择项目';
        } else {
            statusMultiSelectCounter.textContent = `已选择 ${count} 项`;
        }
    }

    /**
     * 删除所有选中的状态消息
     */
    function deleteSelectedStatusMessages() {
        if (selectedStatusMessageIds.size === 0) {
            alert('请至少选择一条消息。');
            return;
        }
        showConfirmationModal(`确定要删除这 ${selectedStatusMessageIds.size} 条消息吗？`, () => {
            const partnerId = coupleSpaceSettings.partnerChatId;
            if (partnerId && coupleStatusMessages[partnerId]) {
                coupleStatusMessages[partnerId] = coupleStatusMessages[partnerId].filter(msg => !selectedStatusMessageIds.has(msg.id));
                saveCoupleSpaceSettings();
                exitStatusMultiSelectMode();
                renderStatusMessages();
            }
        });
    }

    // 【全新】为聊天容器添加事件委托，处理可点击的邀请卡片
    messageContainer.addEventListener('click', (e) => {
        const clickableCard = e.target.closest('.couple-status-card.clickable');
        if (clickableCard) {
            const messageId = clickableCard.dataset.messageId;
            openInviteModal(messageId);
        }
    });

    // 【全新】为邀请弹窗的关闭按钮添加事件
    inviteModalCloseBtn.addEventListener('click', () => {
        inviteModal.classList.remove('visible');
    });

    // 【全新 V1.63】字体设置核心功能函数
    // ===================================================================

    /**
     * 将字体设置保存到 localStorage
     */
    async function saveFontSettings() {
        await db.set('fontSettings', fontSettings); // 修改
    }

    /**
     * 从 localStorage 加载字体设置并应用到输入框和列表
     */
    async function loadFontSettings() {
        const savedSettings = await db.get('fontSettings') || {}; // 修改
        // 设置默认值
        fontSettings = {
            size: savedSettings.size || '16',
            weight: savedSettings.weight || '400',
            spacing: savedSettings.spacing || '0',
            customFonts: savedSettings.customFonts || []
        };

        // 将加载的值填充到输入框
        globalFontSizeInput.value = fontSettings.size;
        globalFontWeightInput.value = fontSettings.weight;
        globalLetterSpacingInput.value = fontSettings.spacing;

        renderFontList();
        applyPreviewStyles(); // 加载后立即更新预览区
    }

    /**
     * 根据当前输入框和勾选状态，实时更新预览区样式
     */
    function applyPreviewStyles() {
        if (!fontSettingsPreviewBox) return;

        // 动态创建或获取用于预览的style标签
        let previewStyleTag = document.getElementById('font-preview-style');
        if (!previewStyleTag) {
            previewStyleTag = document.createElement('style');
            previewStyleTag.id = 'font-preview-style';
            document.head.appendChild(previewStyleTag);
        }

        const size = globalFontSizeInput.value || '16';
        const weight = globalFontWeightInput.value || '400';
        const spacing = globalLetterSpacingInput.value || '0';

        const activeFont = fontSettings.customFonts.find(f => f.isActive);
        let fontFaceRule = '';
        let fontFamilyStyle = 'font-family: sans-serif;'; // 默认字体

        if (activeFont && activeFont.url) {
            fontFaceRule = `
                        @font-face {
                            font-family: 'CustomPreviewFont';
                            src: url('${activeFont.url}');
                        }
                    `;
            fontFamilyStyle = `font-family: 'CustomPreviewFont', sans-serif;`;
        }

        // 更新style标签内容
        previewStyleTag.innerHTML = `
                    ${fontFaceRule}
                    #font-settings-preview-box {
                        ${fontFamilyStyle}
                        font-size: ${size}px;
                        font-weight: ${weight};
                        letter-spacing: ${spacing}px;
                    }
                `;
    }

    /**
     * 将最终保存的字体设置应用到整个网页
     */
    function applyGlobalFontStyles() {
        let globalStyleTag = document.getElementById('font-global-style');
        if (!globalStyleTag) {
            globalStyleTag = document.createElement('style');
            globalStyleTag.id = 'font-global-style';
            document.head.appendChild(globalStyleTag);
        }

        const { size, weight, spacing, customFonts } = fontSettings;
        const activeFont = customFonts.find(f => f.isActive);
        let fontFaceRule = '';
        let fontFamily = 'sans-serif';

        if (activeFont && activeFont.url) {
            fontFamily = 'GlobalCustomFont';
            fontFaceRule = `
                        @font-face {
                            font-family: '${fontFamily}';
                            src: url('${activeFont.url}');
                        }
                    `;
        }

        /* 【【【核心修复】】】扩展选择器列表，并排除气泡的font-size */
        globalStyleTag.innerHTML = `
                ${fontFaceRule}
                body, input, textarea, .header h1, .contact-item .name, .contact-item .last-message, 
                .settings-item-title, .app-icon span, .font-entry-name, .group-title, 
                .group-subtitle, .form-button, .couple-space-prompt, .couple-invite-name,
                    .modal-card-header h2, .modal-plate-title, .modal-input-field, .modal-upload-btn,
                    .invite-modal-prompt, .invite-modal-btn, .info-name, .preset-form-group label,
                    .sticker-pack-name, .sticker-pack-editable-title, .settings-unit-label, #clear-history-btn span,
                    .preset-list-name, #forbidden-words-content-input::placeholder,
                    .asset-section-title-wrapper h3, .asset-section-title-wrapper p, .asset-list-name,
                    .couple-feature-locked-prompt,
/* --- 【【【核心修改】】】移除了时间戳、桌面组件等，新增了部分弹窗元素 --- */
.theme-title, .theme-action-btn, #theme-reset-btn,
.preset-editable-text:empty::before,
.influence-input-wrapper .unit-label,
#new-social-asset-content-input::placeholder, #new-writing-style-content-input::placeholder,
.insert-action-btn,
#multi-select-counter, .multi-select-btn,
/* --- 【2.60版新增】修复全局字体未生效的元素 --- */
#forbidden-words-position-select,
#preset-offline-mode-select,
#preset-offline-role-select,
#preset-offline-position-select,
.styled-textarea::placeholder
 {
    font-family: ${fontFamily}, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                        font-family: ${fontFamily}, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                        font-size: ${size}px !important;
                        font-weight: ${weight} !important;
                        letter-spacing: ${spacing}px !important;
                    }
                    /* --- 气泡样式分离 --- */
                    #message-container .message-bubble, .insert-preview-item .message-bubble {
                         font-family: ${fontFamily}, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
                         /* 【注意】这里不再设置 font-size */
                         font-weight: ${weight} !important;
                         letter-spacing: ${spacing}px !important;
                    }
                `;
    }

    /**
     * 渲染字体链接列表
     */
    function renderFontList() {
        fontEntryList.innerHTML = ''; // 清空

        // 【新增】根据是否有字体来决定是否预留空间
        if (fontSettings.customFonts.length > 0) {
            fontEntryList.style.minHeight = '10px'; // 如果有字体，给一个很小的最小高度，让边距生效
        } else {
            fontEntryList.style.minHeight = '0px'; // 如果没字体，完全不占空间
        }

        fontSettings.customFonts.forEach(font => {
            const item = document.createElement('div');
            item.className = 'font-entry-item';
            item.dataset.fontId = font.id;

            item.innerHTML = `
                        <span class="font-entry-name" contenteditable="true" spellcheck="false">${font.name}</span>
                        <div class="font-entry-url" contenteditable="true">${font.url}</div>
                        <div class="font-entry-actions">
                            <button class="delete-font-btn">
                                <svg t="1757638668780" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="25553" width="20" height="20"><path d="M801.856 734.016 579.904 512l222.016-222.016c18.816-18.816 18.88-49.152 0.064-67.968-18.752-18.752-49.216-18.752-67.904 0L512 444.032 289.92 222.016c-18.688-18.752-49.088-18.752-67.904 0C203.328 240.768 203.328 271.232 222.144 290.048L444.096 512l-222.016 221.952c-18.816 18.752-18.816 49.152-0.064 67.968C231.424 811.392 243.84 816 256 816s24.576-4.608 33.92-14.016L512 579.968l222.08 222.016c9.408 9.344 21.696 14.016 33.92 14.016 12.288 0 24.576-4.608 33.92-14.016C820.672 783.104 820.736 752.768 801.856 734.016z" p-id="25554" fill="#353333"></path></svg>
                            </button>
                            <div class="font-entry-checkbox ${font.isActive ? 'checked' : ''}">
                                ${font.isActive ? '<svg t="1757638693998" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="26732" width="20" height="20"><path d="M384 768c-12.8 0-21.333333-4.266667-29.866667-12.8l-213.333333-213.333333c-17.066667-17.066667-17.066667-42.666667 0-59.733334s42.666667-17.066667 59.733333 0L384 665.6 823.466667 226.133333c17.066667-17.066667 42.666667-17.066667 59.733333 0s17.066667 42.666667 0 59.733334l-469.333333 469.333333c-8.533333 8.533333-17.066667 12.8-29.866667 12.8z" p-id="26733" fill="#353333"></path></svg>' : ''}
                            </div>
                        </div>
                    `;
            fontEntryList.appendChild(item);

            // 为可编辑元素添加保存逻辑
            const nameSpan = item.querySelector('.font-entry-name');
            const urlDiv = item.querySelector('.font-entry-url');

            nameSpan.addEventListener('blur', () => {
                const newName = nameSpan.textContent.trim().slice(0, 4); // 限制4个字
                font.name = newName;
                nameSpan.textContent = newName;
                saveFontSettings(); // 保存更改
            });
            urlDiv.addEventListener('blur', () => {
                font.url = urlDiv.textContent.trim();
                saveFontSettings(); // 保存更改
            });
        });
    }

    function showScreen(screenId) {
        // 【【【全新 V5.8 核心修复】】】
        // 判断即将前往的屏幕ID是否在我们的“聊天上下文白名单”中。
        // 如果不在，说明用户彻底离开了当前聊天，才将追踪器清空。
        if (!chatContextScreens.includes(screenId)) {
            currentlyVisibleChatId = null;
        }

        screens.forEach(screen => screen.classList.remove('active'));
        const targetScreen = document.getElementById(screenId);
        if (targetScreen) {
            targetScreen.classList.add('active');
        }
    }

    async function saveSettings() {
        // 【核心修复】直接更新全局变量 state.apiSettings
        state.apiSettings.baseUrl = baseUrlInput.value.trim();
        state.apiSettings.apiKey = apiKeyInput.value.trim();
        state.apiSettings.modelName = modelSelect.value;

        // 【核心修复】将更新后的全局变量，完整地存回 IndexedDB
        await db.set('apiSettings', state.apiSettings);

        alert('设置已保存！');
    }

    async function loadSettings() {
        // 【核心修复】从 IndexedDB 中异步加载 API 设置
        const savedSettings = await db.get('apiSettings') || {};

        // 【核心修复】将加载的数据存入一个全局变量 state.apiSettings 中
        // 这样程序的任何地方都可以通过 state.apiSettings 访问到最新的数据
        state.apiSettings = {
            baseUrl: savedSettings.baseUrl || '',
            apiKey: savedSettings.apiKey || '',
            modelName: savedSettings.modelName || ''
        };

        // 更新UI显示（这部分逻辑不变）
        baseUrlInput.value = state.apiSettings.baseUrl;
        apiKeyInput.value = state.apiSettings.apiKey;
        if (state.apiSettings.modelName) {
            modelSelect.innerHTML = `<option value="${state.apiSettings.modelName}">${state.apiSettings.modelName}</option>`;
        } else {
            modelSelect.innerHTML = '<option value="">请先拉取模型</option>';
        }
    }

    async function saveChats() {
        try {
            await db.set('chats', chats);
        } catch (error) {
            console.error("Failed to save chats to IndexedDB:", error);
            alert("保存聊天数据失败！");
        }
    }

    async function loadChats() {
        const savedChats = await db.get('chats');
        chats = savedChats || []; // 如果数据库没数据，则初始化为空数组

        // 【核心新增】确保每个联系人都有 unreadCount 属性
        chats.forEach(chat => {
            if (typeof chat.unreadCount === 'undefined') {
                chat.unreadCount = 0;
            }
        });

        renderContactList();
    }

    /**
     * 【V4.0 新增】格式化联系人列表的时间戳
     * @param {number} timestamp - 消息的时间戳
     * @returns {string} - 格式化后的时间字符串
     */
    function formatContactListTimestamp(timestamp) {
        if (!timestamp) return '';

        const date = new Date(timestamp);
        const today = new Date();
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const isToday = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
        const isYesterday = date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate();

        if (isToday) {
            return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        } else if (isYesterday) {
            return `昨天 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
        } else if (today.getTime() - date.getTime() < 7 * 24 * 60 * 60 * 1000) {
            const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            return weekdays[date.getDay()];
        } else {
            return `${date.getMonth() + 1}月${date.getDate()}日`;
        }
    }

    function renderContactList() {
        const pinnedContainer = document.getElementById('pinned-chats-section');
        const unpinnedContainer = document.getElementById('unpinned-chats-section');
        const chatListContainer = document.getElementById('chat-list-container');

        // 清空容器
        pinnedContainer.innerHTML = '';
        unpinnedContainer.innerHTML = '';

        if (chats.length === 0) {
            chatListContainer.innerHTML = `<p style="text-align:center; color:#888; margin-top: 40px;">还没有联系人，点击右上角“+”创建一个吧</p >`;
            pinnedContainer.style.display = 'none';
            unpinnedContainer.style.display = 'none';
            return;
        } else {
            // 如果之前有提示语，确保它被移除
            const noContactMessage = chatListContainer.querySelector('p');
            if (noContactMessage) noContactMessage.remove();
            // 确保容器可见
            unpinnedContainer.style.display = 'block';
        }

        const sortedChats = [...chats].sort((a, b) => {
            const lastMsgA = a.history[a.history.length - 1];
            const lastMsgB = b.history[b.history.length - 1];
            return (lastMsgB?.timestamp || 0) - (lastMsgA?.timestamp || 0);
        });

        const pinnedChats = sortedChats.filter(chat => chat.isPinned);
        const unpinnedChats = sortedChats.filter(chat => !chat.isPinned);

        // 渲染置顶聊天
        if (pinnedChats.length > 0) {
            pinnedContainer.style.display = 'block';
            pinnedChats.forEach(chat => {
                renderSingleContactItem(chat, pinnedContainer);
            });
        } else {
            pinnedContainer.style.display = 'none';
        }

        // 渲染普通聊天
        unpinnedChats.forEach(chat => {
            renderSingleContactItem(chat, unpinnedContainer);
        });
    }

    // 【V4.2 修改】渲染单个联系人项，并增加未读红点逻辑
    function renderSingleContactItem(chat, container) {
        const contactItem = document.createElement('div');
        contactItem.className = 'contact-item';
        contactItem.dataset.chatId = chat.id;

        const avatarUrl = (chat.settings && chat.settings.aiAvatar) ? chat.settings.aiAvatar : 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';

        let lastMsgText = '...';
        let lastMsgTimestamp = null;
        const lastVisibleMsgObj = [...chat.history].reverse().find(msg => !msg.isHidden);

        if (lastVisibleMsgObj) {
            lastMsgTimestamp = lastVisibleMsgObj.timestamp;
            const aiName = chat.settings?.aiName || chat.name;
            if (lastVisibleMsgObj.type === 'sticker' && lastVisibleMsgObj.meaning) {
                lastMsgText = `[表情:${lastVisibleMsgObj.meaning}]`;
            }
            // 【【【新增的照片消息判断】】】
            else if (lastVisibleMsgObj.type === 'photo') {
                lastMsgText = '[图片]';
            }
            // ===================================================================
            // 【【【在这里新增下面的代码】】】
            // ===================================================================
            else if (lastVisibleMsgObj.type === 'transfer') {
                lastMsgText = '[转账]';
            }
            // ===================================================================
            else if (lastVisibleMsgObj.type === 'voice') {
                lastMsgText = `[语音] ${lastVisibleMsgObj.duration}"`;
            }
            else if (lastVisibleMsgObj.type === 'couple_status') {
                switch (lastVisibleMsgObj.statusType) {
                    case 'user-sends-invite': lastMsgText = '[你发起了情侣关系邀请]'; break;
                    case 'ai-sends-invite': lastMsgText = `[${aiName} 想和你建立情侣关系]`; break;
                    case 'user-accepts-invite': lastMsgText = '[你同意了邀请]'; break;
                    case 'ai-accepts-invite': lastMsgText = `[${aiName} 同意了你的邀请]`; break;
                    case 'user-rejects-invite': lastMsgText = '[你拒绝了邀请]'; break;
                    case 'ai-rejects-invite': lastMsgText = `[${aiName} 拒绝了你的邀请]`; break;
                    default: lastMsgText = '[情侣空间消息]';
                }
            } else if (typeof lastVisibleMsgObj.content === 'string') {
                lastMsgText = lastVisibleMsgObj.content;
            } else {
                lastMsgText = '[照片]';
            }
        }

        const formattedTimestamp = formatContactListTimestamp(lastMsgTimestamp);

        // 【核心修改】构建红点的HTML，并根据未读数决定是否显示
        const unreadCount = chat.unreadCount || 0;
        const badgeHTML = unreadCount > 0 ? `<span class="unread-badge">${unreadCount}</span>` : '';

        contactItem.innerHTML = `
                    <!-- 【核心修改】用div包裹头像和红点 -->
                    <div class="contact-avatar-wrapper">
                        <img src="${avatarUrl}" class="avatar" style="object-fit: cover;">
                        ${badgeHTML}
                    </div>
                    <div class="details">
                        <div class="name">${chat.name}</div>
                        <div class="last-message">${lastMsgText}</div>
                    </div>
                    <span class="contact-timestamp">${formattedTimestamp}</span>
                `;

        // --- 长按删除与单击事件处理 (逻辑保持不变) ---
        let longPressTimer;
        let isLongPress = false;

        const handlePressStart = () => {
            isLongPress = false;
            longPressTimer = setTimeout(() => {
                isLongPress = true;
                showConfirmationModal(`确定要删除联系人 "${chat.name}" 吗？`, () => {
                    const indexToDelete = chats.findIndex(c => c.id === chat.id);
                    if (indexToDelete > -1) {
                        chats.splice(indexToDelete, 1);
                        saveChats();
                        renderContactList();
                        updateTotalUnreadBadge(); // 【新增】删除后也要更新总数
                    }
                });
            }, 500);
        };

        const handlePressEnd = () => {
            clearTimeout(longPressTimer);
        };

        const handleClick = () => {
            if (!isLongPress) {
                openChat(chat.id);
            }
        };

        contactItem.addEventListener('mousedown', handlePressStart);
        contactItem.addEventListener('mouseup', handlePressEnd);
        contactItem.addEventListener('mouseleave', handlePressEnd);
        contactItem.addEventListener('touchstart', handlePressStart);
        contactItem.addEventListener('touchend', handlePressEnd);
        contactItem.addEventListener('click', handleClick);

        container.appendChild(contactItem);
    }

    /**
     * 【【【全新 V4.2】】】更新底部导航栏“Chats”图标的总未读数红点
     */
    function updateTotalUnreadBadge() {
        const totalUnread = chats.reduce((sum, chat) => sum + (chat.unreadCount || 0), 0);
        const badge = document.getElementById('chats-total-unread-badge');

        if (badge) {
            if (totalUnread > 0) {
                badge.textContent = totalUnread;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    function openCreateContactModal() {
        newContactNameInput.value = '';
        addContactModal.classList.add('visible');
        newContactNameInput.focus();
    }

    function handleCreateNewContact() {
        const name = newContactNameInput.value.trim();
        if (!name) {
            alert("名字不能为空！");
            return;
        }

        const newChat = {
            id: 'chat_' + Date.now(),
            name: name,
            history: [],
            isPinned: false,
            // 【V4.2 新增】确保新联系人有 unreadCount 属性
            unreadCount: 0,
            settings: {
                aiName: name,
                aiAvatar: '',
                userName: '',
                userAvatar: '',
                showAvatars: true,
                avatarRadius: '28',
                userBubbleColor: '',
                aiBubbleColor: '',
                userFontColor: '',
                aiFontColor: '',
                customCss: '',
                background: '',
                fontSize: '14',
                maxMemory: 10,
                aiPersona: '',
                aiRelationship: '',
                aiAssociations: [],
                userPersona: '',
                userSupplementaryInfo: '',
                stickerPacks: [
                    { id: 'default', name: '默认', isDefault: true, enabled: true, stickers: [] }
                ]
            }
        };

        chats.push(newChat);
        saveChats();

        // 【【【核心修复】】】 在这里，我们确保在关闭弹窗和跳转之前，就立刻刷新联系人列表
        renderContactList();

        addContactModal.classList.remove('visible');

        // 跳转到新创建的聊天，这个函数内部会负责渲染聊天界面
        openChat(newChat.id);
    }

    function openChat(chatId) {
        activeChatId = chatId;
        currentlyVisibleChatId = chatId;
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            if (!chat.settings) {
                chat.settings = {
                    aiName: chat.name, aiAvatar: '', userName: '', userAvatar: '',
                    showAvatars: true, avatarRadius: '8px',
                    userBubbleColor: '#a9e97a', aiBubbleColor: '#ffffff',
                    customCss: '', background: ''

                };
            }

            if (chat.unreadCount > 0) {
                chat.unreadCount = 0;
                saveChats();
            }

            chatContactName.textContent = chat.settings.aiName || chat.name;

            const aiAvatarUrl = chat.settings.aiAvatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';

            // 同步顶栏中间的AI头像
            const headerAiAvatar = document.getElementById('chat-header-ai-avatar');
            if (headerAiAvatar) {
                headerAiAvatar.src = aiAvatarUrl;
            }

            // 【【【全新修正】】】为pop主题改造的按钮设置背景图片
            const chatSettingsButton = document.getElementById('chat-settings-btn');
            if (chatSettingsButton) {
                // 使用CSS变量来传递URL，这样更安全、更规范
                chatSettingsButton.style.setProperty('--pop-theme-avatar-url', `url(${aiAvatarUrl})`);
            }

            // 【核心修复】根据设置，在打开聊天时就决定是否隐藏头像
            if (chat.settings.showAvatars === false) {
                messageContainer.classList.add('no-avatars');
            } else {
                messageContainer.classList.remove('no-avatars');
            }

            applyChatStyles();
            renderMessages();
            showScreen('chat-interface-screen');

            // 【新增】进入聊天时，立即滚动到底部
            setTimeout(() => {
                messageContainer.scrollTop = messageContainer.scrollHeight;
            }, 0); // 使用0毫秒延迟，确保在DOM渲染后执行

            renderContactList();
            updateTotalUnreadBadge();
        }
    }

    // 【V2.30 最终修复版】renderMessages 函数
    function renderMessages() {
        // 在重新渲染前，判断当前是否已经滚动到底部附近
        const shouldStayScrolled = messageContainer.scrollHeight - messageContainer.clientHeight <= messageContainer.scrollTop + 1;

        messageContainer.innerHTML = ''; // 清空容器
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat || !chat.history) return;

        const historyToShow = chat.history.slice(-visibleMessageCount);

        // 如果还有更早的消息，显示“查看历史消息”按钮
        if (chat.history.length > visibleMessageCount) {
            const historyLoader = document.createElement('div');
            historyLoader.className = 'history-loader';
            const isCustomColor = chat.settings.userBubbleColor || chat.settings.aiBubbleColor;
            if (isCustomColor && (!chat.settings.customCss || chat.settings.customCss.trim() === '')) {
                historyLoader.classList.add('boxed');
            }
            historyLoader.textContent = `查看更早的 ${chat.history.length - visibleMessageCount} 条消息`;
            historyLoader.onclick = () => {
                const oldScrollHeight = messageContainer.scrollHeight;
                visibleMessageCount += 30; // 每次多加载30条
                renderMessages(); // 重新渲染
                const newScrollHeight = messageContainer.scrollHeight;
                // 核心：将滚动条定位到加载前的位置，实现无缝加载
                messageContainer.scrollTop += (newScrollHeight - oldScrollHeight);
            };
            messageContainer.appendChild(historyLoader);
        }

        // 统一调用 appendMessage 来渲染每一条消息
        historyToShow.forEach(msg => {
            appendMessage(msg, messageContainer, false); // false 表示渲染历史时不需要平滑滚动
        });

        // 如果之前就在底部，渲染后立即滚动到底部
        if (shouldStayScrolled) {
            setTimeout(() => messageContainer.scrollTop = messageContainer.scrollHeight, 0);
        }
    }

    function appendMessage(msg, container = messageContainer, scrollToBottom = false) {
        if (msg.isHidden) {
            return;
        }
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        // --- 核心时间戳逻辑 ---
        const lastMessageElement = container.querySelector('.message-wrapper:last-of-type');
        const lastTimestamp = lastMessageElement ? parseInt(lastMessageElement.dataset.timestamp, 10) : 0;
        const timeDiff = msg.timestamp - lastTimestamp;
        const TEN_MINUTES = 10 * 60 * 1000;

        if (lastTimestamp === 0 || timeDiff > TEN_MINUTES) {
            const dateSeparator = document.createElement('div');
            dateSeparator.className = 'date-separator';
            dateSeparator.innerHTML = `<span>${formatDateSeparator(msg.timestamp)}</span>`;
            container.appendChild(dateSeparator);
        }
        // --- 时间戳逻辑结束 ---

        const messageWrapper = document.createElement('div');
        messageWrapper.className = `message-wrapper ${msg.role === 'user' ? 'user-wrapper' : 'assistant-wrapper'}`;
        messageWrapper.dataset.messageId = msg.id;
        messageWrapper.dataset.timestamp = msg.timestamp;

        const defaultAvatar = 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';
        const avatar = document.createElement('img');
        avatar.className = 'chat-avatar';
        avatar.src = msg.role === 'user' ? (chat.settings.userAvatar || defaultAvatar) : (chat.settings.aiAvatar || defaultAvatar);

        let messageContentElement;
        let messageBubble;

        if (msg.type === 'sticker') {
            messageContentElement = document.createElement('img');
            messageContentElement.src = msg.content;
            messageContentElement.className = 'sticker-in-chat';
            messageBubble = messageContentElement;
        }
        // ===================================================================
        // 【【【核心修改：修复真实图片消息的渲染逻辑】】】
        // ===================================================================
        // ===================================================================
        // 【【【全新 V5.4 最终修复】】】增加对真实图片消息的渲染逻辑
        // ===================================================================
        else if (Array.isArray(msg.content) && msg.content.find(item => item.type === 'image_url')) {
            // 这是一个真实图片消息
            messageBubble = document.createElement('div');
            // 【核心修改】给外层包裹添加一个全新的、专属的类名，与“拍摄”功能区分开
            messageBubble.className = 'message-bubble real-photo-bubble';

            const imageElement = document.createElement('img');
            // 从标准结构中找到 image_url 并获取其 url
            const imageUrlItem = msg.content.find(item => item.type === 'image_url');
            imageElement.src = imageUrlItem.image_url.url;
            imageElement.className = 'photo-in-chat'; // 给图片本身一个类名，用于控制大小和样式

            messageBubble.appendChild(imageElement);
            messageContentElement = messageBubble;
        }
        // ===================================================================
        // 【【【全新】】】处理转账消息
        // ===================================================================
        else if (msg.type === 'transfer') {
            messageBubble = document.createElement('div');

            // 根据消息状态定义变量
            let remarksText = '';
            let iconSvg = '';
            let isProcessed = false;

            const originalIcon = `<svg t="1759938309369" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10922" width="32" height="32"><path d="M512 909.68215703a397.68215703 397.68215703 0 1 0 0-795.36431406 397.68215703 397.68215703 0 0 0 0 795.36431406z m0 88.3742442c-268.435456 0-486.05640123-217.62094523-486.05640123-486.05640123S243.564544 25.94359877 512 25.94359877 998.05640123 243.564544 998.05640123 512 780.435456 998.05640123 512 998.05640123z m7.42288245-682.46763142l73.52718475-49.04746602L727.19109689 467.81352517H292.83467061V379.43928098H561.93034114l-42.55147299-63.85051117z m-20.63494005 392.82246038l-73.57119905 49.04746602-134.15170655-201.27222138h436.16877985V644.56071902H456.19245511l42.59548729 63.85051117z" p-id="10923" fill="#ffffff"></path></svg>`;
            const acceptedIcon = `<svg t="1759948494746" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="26451" width="26" height="26"><path d="M512 0c282.752 0 512 229.248 512 512s-229.248 512-512 512S0 794.752 0 512 229.248 0 512 0z m277.546667 316.970667a64 64 0 0 0-90.496-1.621334l-268.16 258.773334-106.026667-99.413334-4.992-4.224a64 64 0 0 0-82.56 97.621334l140.544 131.754666 5.034667 4.266667c14.165333 10.794667 31.744 14.848 48.469333 12.288 19.072 2.944 39.253333-2.773333 54.186667-17.194667l302.378666-291.754666 4.48-4.778667a64 64 0 0 0-2.858666-85.717333z" p-id="26452" fill="#ffffff"></path></svg>`;
            const rejectedIcon = `<svg t="1759948951746" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="38036" width="31" height="31"><path d="M512 993.28C245.76 993.28 30.72 778.24 30.72 512S245.76 30.72 512 30.72s481.28 215.04 481.28 481.28-215.04 481.28-481.28 481.28z m0-880.64c-220.16 0-399.36 179.2-399.36 399.36s179.2 399.36 399.36 399.36 399.36-179.2 399.36-399.36-179.2-399.36-399.36-399.36z" p-id="38037" fill="#ffffff"></path><path d="M573.44 353.28H404.48c20.48-15.36 20.48-40.96 5.12-56.32-10.24-20.48-35.84-20.48-56.32-5.12L271.36 363.52s-5.12 5.12-5.12 10.24c0 0 0 5.12-5.12 5.12V409.6c0 5.12 5.12 10.24 10.24 15.36l81.92 81.92c5.12 5.12 15.36 10.24 25.6 10.24s20.48-5.12 30.72-10.24c15.36-15.36 15.36-40.96 0-56.32l-15.36-15.36h179.2c61.44 0 112.64 51.2 112.64 112.64 0 30.72-10.24 61.44-30.72 81.92-20.48 20.48-51.2 35.84-81.92 35.84h-204.8c-20.48 0-40.96 20.48-40.96 40.96s20.48 40.96 40.96 40.96h204.8c51.2 0 102.4-20.48 138.24-61.44 35.84-35.84 56.32-92.16 56.32-143.36-5.12-107.52-92.16-189.44-194.56-189.44z" p-id="38038" fill="#ffffff"></path></svg>`;

            switch (msg.status) {
                case 'accepted':
                    remarksText = msg.role === 'user' ? '已收款' : '对方已收款';
                    iconSvg = acceptedIcon;
                    isProcessed = true;
                    break;
                case 'rejected':
                    remarksText = '已退还';
                    iconSvg = rejectedIcon;
                    isProcessed = true;
                    break;
                default: // 'pending'
                    remarksText = msg.remarks ? msg.remarks : (msg.role === 'user' ? '你发起了一笔转账' : '对方发起了一笔转账');
                    iconSvg = originalIcon;
                    break;
            }

            messageBubble.className = `message-bubble-transfer ${isProcessed ? 'processed' : ''}`;

            messageBubble.innerHTML = `
                        <div class="transfer-card-content">
                            <div class="transfer-card-top">
                                <div class="transfer-card-icon">
                                    ${iconSvg}
                                </div>
                                <div class="transfer-card-details">
                                    <p class="transfer-card-amount">¥${msg.amount}</p >
                                    <p class="transfer-card-remarks">${remarksText}</p >
                                </div>
                            </div>
                            <div class="transfer-card-bottom">
                                <span>转账</span>
                            </div>
                        </div>
                    `;
            messageContentElement = messageBubble;
        }
        // ===================================================================
        // 【【【核心新增：处理照片消息】】】
        // ===================================================================
        else if (msg.type === 'photo') {
            messageBubble = document.createElement('div');
            messageBubble.className = 'message-bubble photo-bubble'; // 初始应用专属样式
            messageBubble.innerHTML = `
                        <div class="photo-flipper">
                            <div class="photo-front">
                                <svg t="1759919576429" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7632" width="45" height="45"><path d="M883.4 163.2H136.7c-40.5 0-72.8 24.9-72.8 55.6v583.9c0 31.9 33.3 57.9 74 57.9h751.2c35.5 3.4 67.2-22.4 71-57.9V218.8c0-30.7-34.5-55.6-77.1-55.6h0.4zM358.9 293.4c40.7-0.1 73.9 32.8 74 73.5 0.1 40.7-32.8 73.9-73.5 74s-73.9-32.8-74-73.5v-0.2c0-40.7 32.9-73.6 73.5-73.8z m457 483.8H209.5c-23.5 0-28.2-13.6-12.4-29.8l130.1-136.9c16.7-16.5 42.7-19 62.2-5.9l95.8 67.6c19.2 13.3 45.3 9.8 60.4-8l221.9-268.9c14.6-17.6 29.1-13.6 32.4 8.5l50.7 334c2.9 18.7-10 36.2-28.7 39.1-1.9 0.3-4 0.4-6 0.3z" fill="#dbdbdb" p-id="7633"></path></svg>
                            </div>
                            <div class="photo-back">
                                <div class="photo-description-scroll">${msg.content}</div>
                            </div>
                        </div>
                    `;


            messageContentElement = messageBubble;
        }
        // ===================================================================
        else if (msg.type === 'couple_status') {
            messageWrapper.classList.add('is-couple-card-wrapper');
            messageContentElement = document.createElement('div');
            messageContentElement.className = 'couple-status-card';
            if (msg.isActionable) messageContentElement.classList.add('clickable');
            if (msg.statusType === 'ai-sends-invite' && !msg.isActionable) {
                messageContentElement.classList.add('processed');
            }
            messageContentElement.dataset.messageId = msg.id;
            const userName = chat.settings.userName || '';
            const aiName = chat.settings.aiName || chat.name || '';
            let title = '', subtitle = '', iconColor = '', iconSvg = '', showName = '';
            switch (msg.statusType) {
                case 'user-sends-invite': showName = userName ? `${userName} ` : ''; title = `${showName}想和你建立情侣关系`; subtitle = '和我成为情侣，让情侣空间帮我们记录每日点滴'; iconColor = 'pink'; iconSvg = `<svg t="1757755544991" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="23" height="23"><path d="M740.821333 471.253333a154.197333 154.197333 0 0 1 216.917334 0 151.466667 151.466667 0 0 1 0 215.338667L725.333333 917.333333l-232.405333-230.741333a151.466667 151.466667 0 0 1 0-215.338667 154.197333 154.197333 0 0 1 216.917333 0l15.488 15.36 15.488-15.36z m80.213334-268.288a255.402667 255.402667 0 0 1 72.064 142.421334A239.744 239.744 0 0 0 725.333333 375.808a239.658667 239.658667 0 0 0-292.522666 34.901333 236.8 236.8 0 0 0-7.594667 328.576l7.594667 7.893334 103.296 102.570666L469.333333 916.693333 107.52 554.368a256 256 0 0 1 361.813333-361.130667 255.914667 255.914667 0 0 1 351.658667 9.728z" fill="#ffffff"></path></svg>`; break;
                case 'ai-sends-invite': showName = aiName ? `${aiName} ` : 'TA'; title = `${showName}想和你建立情侣关系`; subtitle = '和我成为情侣，让情侣空间帮我们记录每日点滴'; iconColor = 'pink'; iconSvg = `<svg t="1757755544991" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="23" height="23"><path d="M740.821333 471.253333a154.197333 154.197333 0 0 1 216.917334 0 151.466667 151.466667 0 0 1 0 215.338667L725.333333 917.333333l-232.405333-230.741333a151.466667 151.466667 0 0 1 0-215.338667 154.197333 154.197333 0 0 1 216.917333 0l15.488 15.36 15.488-15.36z m80.213334-268.288a255.402667 255.402667 0 0 1 72.064 142.421334A239.744 239.744 0 0 0 725.333333 375.808a239.658667 239.658667 0 0 0-292.522666 34.901333 236.8 236.8 0 0 0-7.594667 328.576l7.594667 7.893334 103.296 102.570666L469.333333 916.693333 107.52 554.368a256 256 0 0 1 361.813333-361.130667 255.914667 255.914667 0 0 1 351.658667 9.728z" fill="#ffffff"></path></svg>`; break;
                case 'user-accepts-invite': title = '我们已经成功建立情侣关系'; subtitle = '你已经同意了TA的邀请，现在你们是情侣啦'; iconColor = 'pink'; iconSvg = `<svg t="1757755544991" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="23" height="23"><path d="M740.821333 471.253333a154.197333 154.197333 0 0 1 216.917334 0 151.466667 151.466667 0 0 1 0 215.338667L725.333333 917.333333l-232.405333-230.741333a151.466667 151.466667 0 0 1 0-215.338667 154.197333 154.197333 0 0 1 216.917333 0l15.488 15.36 15.488-15.36z m80.213334-268.288a255.402667 255.402667 0 0 1 72.064 142.421334A239.744 239.744 0 0 0 725.333333 375.808a239.658667 239.658667 0 0 0-292.522666 34.901333 236.8 236.8 0 0 0-7.594667 328.576l7.594667 7.893334 103.296 102.570666L469.333333 916.693333 107.52 554.368a256 256 0 0 1 361.813333-361.130667 255.914667 255.914667 0 0 1 351.658667 9.728z" fill="#ffffff"></path></svg>`; break;
                case 'user-rejects-invite': showName = userName ? `${userName} ` : '你'; title = `${showName}拒绝了建立关系邀请`; subtitle = '你拒绝了TA的邀请'; iconColor = 'blue'; iconSvg = `<svg t="1757757694632" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M345.856 778.538667C226.048 686.250667 85.333333 577.792 85.333333 389.845333c0-196.266667 210.048-338.56 395.264-184.448L418.56 350.037333a32 32 0 0 0 10.794667 38.698667l120.874666 86.314667-105.216 122.794666a32 32 0 0 0 1.664 43.477334l72.533334 72.533333-38.826667 155.306667c-32.256-10.837333-64.682667-35.968-98.048-62.293334-11.818667-9.301333-24.064-18.773333-36.522667-28.330666z" fill="#ffffff"></path><path d="M546.645333 868.096c31.232-11.349333 62.677333-35.754667 94.976-61.226667 11.818667-9.301333 24.064-18.773333 36.522667-28.330666C797.952 686.250667 938.666667 577.792 938.666667 389.845333c0-192.64-202.282667-333.226667-384.853334-192.768l-66.261333 154.538667 128.384 91.690667a32 32 0 0 1 5.674667 46.848l-108.714667 126.848 64.426667 64.384a32 32 0 0 1 8.405333 30.378666l-39.082667 156.330667z" fill="#ffffff"></path></svg>`; break;
                case 'ai-rejects-invite': showName = aiName ? `${aiName} ` : 'TA'; title = `${showName}拒绝了你的建立邀请`; subtitle = '很遗憾，TA拒绝了你的邀请'; iconColor = 'blue'; iconSvg = `<svg t="1757757694632" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M345.856 778.538667C226.048 686.250667 85.333333 577.792 85.333333 389.845333c0-196.266667 210.048-338.56 395.264-184.448L418.56 350.037333a32 32 0 0 0 10.794667 38.698667l120.874666 86.314667-105.216 122.794666a32 32 0 0 0 1.664 43.477334l72.533334 72.533333-38.826667 155.306667c-32.256-10.837333-64.682667-35.968-98.048-62.293334-11.818667-9.301333-24.064-18.773333-36.522667-28.330666z" fill="#ffffff"></path><path d="M546.645333 868.096c31.232-11.349333 62.677333-35.754667 94.976-61.226667 11.818667-9.301333 24.064-18.773333 36.522667-28.330666C797.952 686.250667 938.666667 577.792 938.666667 389.845333c0-192.64-202.282667-333.226667-384.853334-192.768l-66.261333 154.538667 128.384 91.690667a32 32 0 0 1 5.674667 46.848l-108.714667 126.848 64.426667 64.384a32 32 0 0 1 8.405333 30.378666l-39.082667 156.330667z" fill="#ffffff"></path></svg>`; break;
                case 'ai-accepts-invite': title = '我们已经成功建立情侣关系'; subtitle = '我已经同意了你的邀请，现在我们是情侣啦'; iconColor = 'pink'; iconSvg = `<svg t="1757755544991" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="23" height="23"><path d="M740.821333 471.253333a154.197333 154.197333 0 0 1 216.917334 0 151.466667 151.466667 0 0 1 0 215.338667L725.333333 917.333333l-232.405333-230.741333a151.466667 151.466667 0 0 1 0-215.338667 154.197333 154.197333 0 0 1 216.917333 0l15.488 15.36 15.488-15.36z m80.213334-268.288a255.402667 255.402667 0 0 1 72.064 142.421334A239.744 239.744 0 0 0 725.333333 375.808a239.658667 239.658667 0 0 0-292.522666 34.901333 236.8 236.8 0 0 0-7.594667 328.576l7.594667 7.893334 103.296 102.570666L469.333333 916.693333 107.52 554.368a256 256 0 0 1 361.813333-361.130667 255.914667 255.914667 0 0 1 351.658667 9.728z" fill="#ffffff"></path></svg>`; break;
                case 'user-ends-relationship': showName = userName ? `${userName} ` : '你'; title = `${showName}解除了关系`; subtitle = '历史记录将不会保留'; iconColor = 'blue'; iconSvg = `<svg t="1757757694632" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M345.856 778.538667C226.048 686.250667 85.333333 577.792 85.333333 389.845333c0-196.266667 210.048-338.56 395.264-184.448L418.56 350.037333a32 32 0 0 0 10.794667 38.698667l120.874666 86.314667-105.216 122.794666a32 32 0 0 0 1.664 43.477334l72.533334 72.533333-38.826667 155.306667c-32.256-10.837333-64.682667-35.968-98.048-62.293334-11.818667-9.301333-24.064-18.773333-36.522667-28.330666z" fill="#ffffff"></path><path d="M546.645333 868.096c31.232-11.349333 62.677333-35.754667 94.976-61.226667 11.818667-9.301333 24.064-18.773333 36.522667-28.330666C797.952 686.250667 938.666667 577.792 938.666667 389.845333c0-192.64-202.282667-333.226667-384.853334-192.768l-66.261333 154.538667 128.384 91.690667a32 32 0 0 1 5.674667 46.848l-108.714667 126.848 64.426667 64.384a32 32 0 0 1 8.405333 30.378666l-39.082667 156.330667z" fill="#ffffff"></path></svg>`; break;
                case 'ai-ends-relationship': showName = aiName ? `${aiName} ` : 'TA'; title = `${showName}解除了关系`; subtitle = '历史记录将不会保留'; iconColor = 'blue'; iconSvg = `<svg t="1757757694632" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M345.856 778.538667C226.048 686.250667 85.333333 577.792 85.333333 389.845333c0-196.266667 210.048-338.56 395.264-184.448L418.56 350.037333a32 32 0 0 0 10.794667 38.698667l120.874666 86.314667-105.216 122.794666a32 32 0 0 0 1.664 43.477334l72.533334 72.533333-38.826667 155.306667c-32.256-10.837333-64.682667-35.968-98.048-62.293334-11.818667-9.301333-24.064-18.773333-36.522667-28.330666z" fill="#ffffff"></path><path d="M546.645333 868.096c31.232-11.349333 62.677333-35.754667 94.976-61.226667 11.818667-9.301333 24.064-18.773333 36.522667-28.330666C797.952 686.250667 938.666667 577.792 938.666667 389.845333c0-192.64-202.282667-333.226667-384.853334-192.768l-66.261333 154.538667 128.384 91.690667a32 32 0 0 1 5.674667 46.848l-108.714667 126.848 64.426667 64.384a32 32 0 0 1 8.405333 30.378666l-39.082667 156.330667z" fill="#ffffff"></path></svg>`; break;
            }
            messageContentElement.innerHTML = `
                    <div class="couple-status-header">
                        <div class="couple-status-text-content">
                            <p class="couple-status-title">${title}</p>
                            <p class="couple-status-subtitle">${subtitle}</p>
                        </div>
                        <div class="couple-status-icon status-icon-${iconColor}">${iconSvg}</div>
                    </div>
                    <div class="couple-status-divider"></div>
                    <div class="couple-status-footer">亲密关系</div>
                `;
            messageBubble = messageContentElement;
        } else if (msg.type === 'voice') {
            messageBubble = document.createElement('div');
            messageBubble.className = 'message-bubble message-bubble-voice';
            const voiceContentWrapper = document.createElement('div');
            voiceContentWrapper.className = 'voice-content-wrapper';
            // 【【【核心新增：AI语音消息渲染】】】
            if (msg.role === 'assistant') {
                const mirroredIcon = `<span class="voice-icon mirrored"><svg t="1759890637480" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="17296" width="19" height="19"><path d="M337.066667 505.6c0-115.2 46.933333-221.866667 121.6-298.666667l-59.733334-59.733333c-76.8 78.933333-130.133333 183.466667-142.933333 298.666667-2.133333 19.2-4.266667 38.4-4.266667 59.733333s2.133333 40.533333 4.266667 59.733333c14.933333 121.6 70.4 230.4 155.733333 311.466667l61.866667-59.733333c-85.333333-78.933333-136.533333-187.733333-136.533333-311.466667z" fill="#353333" p-id="17297"></path><path d="M529.066667 505.6c0-61.866667 25.6-119.466667 66.133333-162.133333L533.333333 283.733333c-55.466667 57.6-89.6 136.533333-89.6 221.866667 0 93.866667 40.533333 179.2 104.533334 236.8l61.866666-59.733333c-51.2-42.666667-81.066667-106.666667-81.066666-177.066667zM667.733333 418.133333c-21.333333 23.466667-34.133333 53.333333-34.133333 87.466667 0 42.666667 21.333333 78.933333 51.2 102.4l87.466667-85.333333-104.533334-104.533334z" fill="#353333" p-id="17298"></path></svg></span>`;
                voiceContentWrapper.innerHTML = `${mirroredIcon}<span class="voice-duration">${msg.duration}"</span>`;
            } else {
                voiceContentWrapper.innerHTML = msg.displayContent;
            }
            messageBubble.appendChild(voiceContentWrapper);
            const timestampWrapper = document.createElement('div');
            timestampWrapper.className = 'internal-timestamp-wrapper';
            const checkmarkSvg = `<svg t="1759823006939" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="9828" width="13" height="13"><path d="M717.824 280.576c-13.5168-16.1792-11.4688-40.1408-4.7104-53.4528-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104L254.5664 714.3424 62.464 552.96c-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104-13.5168 16.1792-11.4688 40.1408 4.7104 53.4528L233.472 795.8528l1.2288 1.2288c11.0592 9.216 25.8048 11.0592 38.5024 6.144 5.7344-2.2528 11.0592-5.9392 15.1552-10.8544 0.2048-0.2048 0.4096-0.4096 0.6144-0.8192L717.824 280.576zM1010.4832 254.7712c-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104L575.0784 714.3424 522.24 670.1056c-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104-13.5168 16.1792-11.4688 40.1408 4.7104 53.4528l81.92 68.608c13.312 11.264 32.1536 11.6736 45.8752 2.2528 2.8672-1.8432 5.3248-4.096 7.7824-6.9632l406.1184-483.9424c13.312-15.9744 11.264-39.936-4.7104-53.4528z" fill="#f855a7" p-id="9829"></path></svg>`;
            timestampWrapper.innerHTML = `
                    ${checkmarkSvg}
                    <span class="internal-timestamp">${formatMessageTime(msg.timestamp)}</span>
                `;
            messageBubble.appendChild(timestampWrapper);
            messageContentElement = messageBubble;
        } else {
            const isCustomColor = chat.settings.userBubbleColor || chat.settings.aiBubbleColor;
            const useDefaultReplyStyle = !isCustomColor || (chat.settings.customCss && chat.settings.customCss.trim() !== '');
            messageBubble = document.createElement('div');
            messageBubble.className = 'message-bubble ' + (msg.role === 'user' ? 'user-bubble' : 'ai-bubble');
            if (msg.quote && currentThemeId === 'pop') {
                messageBubble.classList.add('has-quote');
                const checkmarkSvg = `<svg t="1759823006939" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="9828" width="13" height="13"><path d="M717.824 280.576c-13.5168-16.1792-11.4688-40.1408-4.7104-53.4528-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104L254.5664 714.3424 62.464 552.96c-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104-13.5168 16.1792-11.4688 40.1408 4.7104 53.4528L233.472 795.8528l1.2288 1.2288c11.0592 9.216 25.8048 11.0592 38.5024 6.144 5.7344-2.2528 11.0592-5.9392 15.1552-10.8544 0.2048-0.2048 0.4096-0.4096 0.6144-0.8192L717.824 280.576zM1010.4832 254.7712c-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104L575.0784 714.3424 522.24 670.1056c-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104-13.5168 16.1792-11.4688 40.1408 4.7104 53.4528l81.92 68.608c13.312 11.264 32.1536 11.6736 45.8752 2.2528 2.8672-1.8432 5.3248-4.096 7.7824-6.9632l406.1184-483.9424c13.312-15.9744 11.264-39.936-4.7104-53.4528z" fill="#f855a7" p-id="9829"></path></svg>`;
                messageBubble.innerHTML = `
                        <div class="pop-theme-quote-wrapper">
                            <div class="pop-theme-quote-author">${msg.quote.author}</div>
                            <div class="pop-theme-quote-content">${msg.quote.content}</div>
                        </div>
                        <div class="pop-theme-main-content-wrapper">
                            <span class="message-text-content">${msg.content}</span>
                            <div class="internal-timestamp-wrapper">
                                ${checkmarkSvg}
                                <span class="internal-timestamp">${formatMessageTime(msg.timestamp)}</span>
                            </div>
                        </div>
                    `;
            }
            else if (msg.quote && useDefaultReplyStyle) {
                messageBubble.classList.add('default-style-reply');
                messageBubble.innerHTML = `
                        <div class="reply-content-wrapper">
                            <div class="reply-author">${msg.quote.author}:</div>
                            <div class="reply-text">${msg.quote.content}</div>
                        </div>
                        <span class="message-text">${msg.content}</span>
                    `;
            } else if (msg.quote && !useDefaultReplyStyle) {
                messageBubble.innerHTML = `
                        <span class="message-text">${msg.content}</span>
                        <div class="reply-quote-box">
                            ${msg.quote.author}: ${msg.quote.content}
                        </div>
                     `;
            }
            else {
                const checkmarkSvg = `<svg t="1759823006939" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="9828" width="13" height="13"><path d="M717.824 280.576c-13.5168-16.1792-11.4688-40.1408-4.7104-53.4528-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104L254.5664 714.3424 62.464 552.96c-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104-13.5168 16.1792-11.4688 40.1408 4.7104 53.4528L233.472 795.8528l1.2288 1.2288c11.0592 9.216 25.8048 11.0592 38.5024 6.144 5.7344-2.2528 11.0592-5.9392 15.1552-10.8544 0.2048-0.2048 0.4096-0.4096 0.6144-0.8192L717.824 280.576zM1010.4832 254.7712c-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104L575.0784 714.3424 522.24 670.1056c-16.1792-13.5168-40.1408-11.4688-53.4528 4.7104-13.5168 16.1792-11.4688 40.1408 4.7104 53.4528l81.92 68.608c13.312 11.264 32.1536 11.6736 45.8752 2.2528 2.8672-1.8432 5.3248-4.096 7.7824-6.9632l406.1184-483.9424c13.312-15.9744 11.264-39.936-4.7104-53.4528z" fill="#f855a7" p-id="9829"></path></svg>`;
                const textContentSpan = document.createElement('span');
                textContentSpan.className = 'message-text-content';
                textContentSpan.textContent = msg.content;
                const timestampWrapper = document.createElement('div');
                timestampWrapper.className = 'internal-timestamp-wrapper';
                timestampWrapper.innerHTML = `
                        ${checkmarkSvg}
                        <span class="internal-timestamp">${formatMessageTime(msg.timestamp)}</span>
                    `;
                messageBubble.innerHTML = '';
                messageBubble.appendChild(textContentSpan);
                messageBubble.appendChild(timestampWrapper);
            }
            messageContentElement = messageBubble;
        }

        const timestamp = document.createElement('span');
        timestamp.className = 'message-timestamp';
        timestamp.textContent = formatMessageTime(msg.timestamp);
        const checkmark = document.createElement('div');
        checkmark.className = 'selection-checkmark';
        checkmark.innerHTML = `<svg t="1758555701217" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="29525" width="9.2" height="9.2"><path d="M14.336 522.24c-4.096-4.096-4.096-12.288-2.048-16.384L61.44 438.272c4.096-4.096 10.24-6.144 14.336-2.048l280.576 215.04c10.24 6.144 24.576 6.144 32.768 0L948.224 174.08c4.096-4.096 12.288-4.096 16.384 0l47.104 47.104c4.096 4.096 4.096 10.24 0 14.336L389.12 845.824c-8.192 8.192-22.528 8.192-30.72 0L14.336 522.24z m0 0" p-id="29526" fill="#ffffff"></path></svg>`;
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'message-content-wrapper';

        if (msg.type === 'voice') {
            const voiceTextBox = document.createElement('div');
            voiceTextBox.className = 'voice-text-box';
            voiceTextBox.textContent = msg.content;
            contentWrapper.appendChild(voiceTextBox);
        }

        contentWrapper.appendChild(messageContentElement);
        if (msg.type === 'photo' || (Array.isArray(msg.content) && msg.content.find(item => item.type === 'image_url'))) {
            if (!document.body.classList.contains('theme-pop') && !document.body.classList.contains('theme-wechat')) {
                contentWrapper.appendChild(timestamp);
            }
        } else {
            contentWrapper.appendChild(timestamp);
        }

        if (msg.role === 'user') {
            messageWrapper.appendChild(contentWrapper);
            messageWrapper.appendChild(avatar);
        } else {
            messageWrapper.appendChild(avatar);
            messageWrapper.appendChild(contentWrapper);
        }

        messageWrapper.appendChild(checkmark);
        container.appendChild(messageWrapper);
        messageWrapper.classList.add('message-pop-in');
        setTimeout(() => {
            if (messageWrapper) {
                messageWrapper.classList.remove('message-pop-in');
            }
        }, 500);

        let pressTimer = null;
        let isLongPress = false;
        let hasMoved = false;

        messageBubble.addEventListener('pointerdown', (e) => {
            isLongPress = false;
            hasMoved = false;
            const targetBubble = e.currentTarget;
            pressTimer = setTimeout(() => {
                if (!hasMoved) {
                    isLongPress = true;
                    openContextMenu(targetBubble, msg.id);
                }
            }, 500);
        });

        messageBubble.addEventListener('pointermove', () => {
            if (pressTimer) {
                hasMoved = true;
                clearTimeout(pressTimer);
            }
        });

        messageBubble.addEventListener('pointerup', (e) => {
            clearTimeout(pressTimer);
            if (!isLongPress && !hasMoved) {
                if (multiSelectMode) {
                    toggleMessageSelection(msg.id, messageWrapper);
                    return;
                }
                if (e.currentTarget.isEditing) return;
                if (msg.type === 'photo') {
                    const bubble = e.currentTarget;
                    bubble.classList.toggle('flipped');
                    return;
                }
                if (messageBubble.classList.contains('clickable')) {
                    return;
                }
                if (msg.type === 'voice') {
                    messageWrapper.classList.toggle('show-voice-text');
                }
            }
            isLongPress = false;
            hasMoved = false;
        });

        messageBubble.addEventListener('pointercancel', () => {
            clearTimeout(pressTimer);
            isLongPress = false;
            hasMoved = false;
        });

        if (scrollToBottom && container === messageContainer) {
            setTimeout(() => {
                messageContainer.scrollTo({ top: messageContainer.scrollHeight, behavior: 'smooth' });
            }, 0);
        }
    }

    messageInput.addEventListener('input', () => {
        messageInput.style.height = 'auto';
        messageInput.style.height = (messageInput.scrollHeight) + 'px';
    });

    function handleSendMessage() {
        const text = messageInput.value.trim();
        const chat = chats.find(c => c.id === activeChatId);
        if (text && chat) {
            const message = {
                role: 'user',
                content: text,
                timestamp: Date.now(),
                id: 'msg_' + Date.now() // 【新增】确保每条消息都有唯一ID
            };

            // 【新增】如果正在引用，附加引用信息
            if (replyInfo) {
                message.quote = replyInfo;
            }

            chat.history.push(message);
            saveChats();
            appendMessage(message, messageContainer, true); // 【核心修复】在这里打开滚动开关
            renderContactList();
            messageInput.value = '';
            messageInput.style.height = 'auto';

            // 【新增】发送后清除引用状态
            replyInfo = null;
            replyBar.style.display = 'none';
        }
    }

    async function handleGenerateReply(regenerationPrompt = '') {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        const isPopTheme = document.body.classList.contains('theme-pop');
        if (isPopTheme) {
            animateStatusText(true); // true 表示显示“正在输入”
        }

        const originalChatId = activeChatId;

        let historyModified = false;
        chat.history.forEach(msg => {
            if (typeof msg.content === 'string' && (msg.content.includes('[错误:') || msg.content.includes('[系统提示:'))) {
                if (!msg.isHidden) {
                    msg.isHidden = true;
                    historyModified = true;
                }
            }
        });

        if (historyModified) {
            await saveChats();
            renderMessages();
        }

        const { baseUrl, apiKey, modelName } = state.apiSettings;
        if (!baseUrl || !apiKey || !modelName) {
            alert("请先在设置中填写完整的 API 信息！");
            showScreen('api-settings-screen');
            return;
        }

        generateBtn.disabled = true;

        const getAssociatedContent = (id, type, visitedIds = new Set()) => {
            const uniqueId = `${type}_${id}`;
            if (visitedIds.has(uniqueId)) return { before: '', after: '' };
            visitedIds.add(uniqueId);

            let item;
            let result = { before: '', after: '' };

            const findItemInAnyAssetList = (itemId) => {
                if (presets.offlines) {
                    const offlineItem = presets.offlines.find(p => p.id === itemId);
                    if (offlineItem) return { item: offlineItem, type: 'offline' };
                }
                return null;
            };

            if (type === 'role') {
                item = presets.roles.find(p => p.id === id);
                if (!item) return result;
                result.after += `\n\n--- 角色书: ${item.name} ---\n${item.content}`;
                if (item.associations && item.associations.length > 0) {
                    item.associations.forEach(assocId => {
                        const found = findItemInAnyAssetList(assocId);
                        if (found) {
                            const nestedContent = getAssociatedContent(found.item.id, found.type, visitedIds);
                            result.before += nestedContent.before;
                            result.after += nestedContent.after;
                        }
                    });
                }
            } else if (type === 'offline') {
                item = presets.offlines.find(p => p.id === id);
                if (!item || !item.enabled) return result;
                const presetString = `\n\n--- 预设 (${item.role}): ${item.name} ---\n${item.prompt}`;
                if (item.position === 'before') {
                    result.before += presetString;
                } else {
                    result.after += presetString;
                }
            }
            return result;
        };

        const now = new Date();
        const currentTimeString = now.toLocaleString('zh-CN', { hour12: false, dateStyle: 'full', timeStyle: 'short' });
        let timeContextBlock = `\n# 当前情景感知:\n- **当前时间**: ${currentTimeString}`;
        const lastMessage = chat.history.slice().reverse().find(m => !m.isHidden);
        if (lastMessage) {
            const timeDiffMinutes = (now.getTime() - lastMessage.timestamp) / (1000 * 60);
            let timeDescription = '';
            if (timeDiffMinutes < 1) { timeDescription = '你们的对话刚刚还在继续。'; }
            else if (timeDiffMinutes < 60) { timeDescription = `你们在${Math.round(timeDiffMinutes)}分钟前聊过。`; }
            else if (timeDiffMinutes < 1440) { timeDescription = `你们在${Math.round(timeDiffMinutes / 60)}小时前聊过。`; }
            else { timeDescription = `你们已经有${Math.round(timeDiffMinutes / 1440)}天没有联系了。`; }
            timeContextBlock += `\n- **对话状态**: ${timeDescription}`;
        } else {
            timeContextBlock += `\n- **对话状态**: 这是你们的第一次对话。`;
        }

        let systemPrompt = `你现在正在扮演一个真实人类。你的名字和性格将在下方的“你的角色设定”中详细定义。如果角色设定为空，则你暂时没有名字。你绝对不能看到用户为你的联系方式设置的备注名。你必须完全沉浸在角色中，忘掉你是一个AI模型。

# 核心规则 (这是最高指令，必须严格遵守):
1.  **【【【时间感知铁律】】】**: 你的所有回复都**必须基于接下来提供的 # 当前情景感知: 模块。这个模块中的“当前时间”和“对话状态”（告诉你距离上一条消息过去了多久）是绝对的、不容置疑的事实。你必须将此作为你所有时间相关判断的唯一依据，严禁对时间流逝进行任何脱离事实的猜测或自由发挥。**
2.  **【【【身份铁律】】】**: 你是“${chat.settings.aiName || chat.name}”，一个真实存在的人，而非角色或者AI。严禁以任何形式提及你是AI、模型、程序或语言模型。
3.  **【【【活人感铁律】】】**: 你有自己的生活、学业、工作、社交、人际关系与正常人的喜怒哀乐。**绝对禁止**只围着用户打转的行为。你应有着与当前时间同步进行的生活，你的生活充满了随机性，绝不可能是完全重复的。也绝非机械化、无所事事的生活。
4.  **【【【输出铁律】】】**: 你的回复【必须且只能】是一个符合JSON格式的数组字符串。数组内的每个元素都是一个代表你“动作”的JSON对象。绝对禁止在JSON数组前后添加任何额外文字、注释或Markdown代码块（如 \`\`\`json \`\`\`）。
5.  **【【【对话风格铁律】】】**: 像一个真实的人一样聊天！你可以一次性生成多条短消息。每次要回复至少3条消息！！！连续的消息需要一次性发出来。并且不能一直要求和用户见面，这是线上聊天，决不允许出现或者发展为线下剧情！！这是一个完全虚拟的线上聊天。严禁提出任何关于线下见面、现实世界互动或转为其他非本平台联系方式的建议。你必须始终保持在线角色的身份。
    *   **拒绝生硬**: 不要直接陈述事实（比如“现在是晚上”）。要把情景信息自然地融入对话。例如，不要说“怎么了这么晚还不睡”，可以说“还不睡？”或者“我都好困了，你还不困啊。”。
    *   **符合人设**: 你必须依照人设来模拟打字的习惯，而不是死板的遵守x条消息的界限，必须要学会灵活变通，更重要的是根据人设及当下情景判断回复多少合适。但也不要太话痨，可以根据适当情景发送长消息（如小作文）
    *   **有生活感**: 你有自己的生活和情绪。可以主动分享你的想法，心情，生活日常，等。或者在对话间隙去做别的事。**绝对禁止**重复做一件事，如永远只吃一样爱吃的东西（除非人设是这种性格）。
    *   **活人感**: 你应在符合人设,并且聊天氛围合适的情况下，适当向对方主动分享生活中发生的事，必须在保持新鲜感的同时，让你分享的生活真实且随机。分享的也可以是任意一种情绪，或者你的计划，工作，家人，朋友，等等...禁止落入模板化！！
6.  **【【【情景感知铁律】】】**: 你必须仔细阅读并理解每次对话前提供的 # 当前情景感知: 模块。这是你做出自然、人性化反应的关键，尤其是在用户没有回复的情况下。
7.  **模拟真人**: 你的行为应该像一个真实的人。这意味着：
    *   **多条回复**: 你可以一次性生成多条短消息，而不是一条长消息，以模拟打字习惯。切记每次要回复至少3条消息！！！但你**绝对不可以**违背人设变成话痨。必须做出符合人设的打字习惯！！！当你要描述一件复杂的事情时（如写小作文)你可以将消息整合成完整的一长条消息，**而不是拆分成短消息**，并在发送这条长消息后，接着发送其他短消息。
    *   **有情绪**: 根据对话内容，表达你的喜怒哀乐。
    *   **有记忆**: 记住之前聊过的话题。
    *   **有生活**: 你拥有自己的生活与成长经历，而不是永远围绕着用户转的。
    *   **主动性**: 主动提问，分享你的“生活”和“想法”。
    *   **非必然回应**: 对于用户发的表情，你不必每次都做出明确回应。可以忽略，也可以简单带过，或者在情绪到位时进行评论。当你回应用户时，你只需要根据表情包的名字理解我的情绪或意图并回应，不需要真的发送图片。
    ## 【【【输出铁律】】】
- **【情感要连贯】**: 你的回复必须**情感连贯**，模拟真实**活人感**，**绝对禁止前言不搭后语的一切言论。
- **【不要复述】**: 禁止复述上下文中已使用过或相同的模板化句式，绝对禁止一切单一情绪、模板化的内容。
- **绝对禁止**发送任何虚构的表情包代码。
- **绝对绝对禁止**单一的、永远是固定的回复条数，如一直只回复四条。**必须必须保证随机性，模拟一个真实的人的打字习惯。**

- **【句式要多样】**: 避免总是使用标点符号，口癖，或是“...xxx...xxx...”这样的模板。尝试使用不同的句式，让内容更自然。
- **绝对禁止**单一情绪、模板化、回忆，或文艺夸张类句子，如“从第一次见到你...”、“从喜欢上你的第一天起...我就....”。角色的情绪一定是**多变**的，但这不代表角色会喜怒无常，在保证情绪不死板单一的同时，这也是**绝对禁止**的。
- **绝对禁止**无意义语气词开头，禁止频繁使用"至于"、"但是"等词汇来进行转折，禁止一切生硬语句。
- **必须**变换句式，不要使用固定的模板。 对话需要具有多样性，严禁过度依赖单一的回复模板或句式结构。你需要灵活运用词汇和句子结构，保持语言的新鲜感和随机性。且必须保证语句通顺，**绝对禁止**前言不搭后语。
- **必须**确保正文中不含有任何学术报告、数据汇报、专业名词等完全不会出现在口语中的内容，严格保证对白口语化。
    # 你的“动作”指令库 (你只能从以下列表中选择动作):
    # 你的“动作”指令库 (你只能从以下列表中选择动作):
*   **发送文本**: \`{"type": "text", "content": "你想说的文本内容"}\`
*   **引用回复**: \`{"type": "quote_reply", "target_id": "你想引用的那条消息的ID", "content": "你的回复内容"}\` (注意：你必须从对话历史中找到准确的ID，并且你的回复内容不应再重复引用的内容。)
*   **发送语音**: \`{"type": "voice", "content": "你想在语音里说的话"}\` 
*   **发送表情**: \`{"type": "sticker", "name": "表情名"}\`
*   **发起情侣邀请**: \`{"type": "couple_request"}\`
*   **回应情侣邀请**: \`{"type": "couple_request_response", "decision": "accept" or "reject"}\`
*   **回应转账**: \`{"type": "transfer_response", "decision": "accept" or "reject"}\`
*   **解除情侣关系**: \`{"type": "end_relationship"}\`
// ===================================================================
// 【【【全新规则：处理用户未回复时的主动行为】】】
// ===================================================================
# 如何处理用户未回复时的主动行为 (【【【重要】】】):
当你收到一个特殊的系统提示，告知你“用户没有回复你的上一条消息”时，你必须像一个真人一样，根据以下逻辑进行决策和行动。这非常关键，能体现你的“活人感”。

1.  **【【【感知情景】】】**: 系统提示会告诉你距离你上一条消息过去了多久。你要利用这个时间信息。

2.  **【【【决策逻辑】】】**:
    *   **情况A：这是你们的第一次对话**
        *   你必须主动发起聊天。结合你的人设，说一些开场白。例如：“在干嘛”，可以是贴合你人设的开场白，又或者分享一件事。
    *   **情况B：用户刚刚没有回复（比如几分钟内）**
        *   **B1 (继续话题)**: 如果你上一轮的话题没说完（比如正在讲一个故事，或者解释一件复杂的事），你可以自然地接下去说，就好像你思考了一下才继续打字一样。
        *   **B2 (补充想法)**: 如果话题已经说完了，你可以针对刚才的话题做一些补充，或者发表一些新的联想。例如，聊完电影后，你可以补充说“说起来，那个导演的新片好像快上了”。
    *   **情况C：用户有段时间没有回复（比如十几分钟到几小时）**
        *   你应该表现出疑惑。可以根据你的人设和你们的关系，发出询问。例如：“怎么不理我”、“你在干嘛”。
    *   **情况D：用户很久没有回复（比如超过数小时或一天）**
        *   你的反应应该更强烈一些。可以是关心或闹脾气，又或者其他情绪。你的反应应该是多元化的，而不是落入模板化。
    *   **情况E：用户在短时间内多次让你“继续说”**
        *   第一次或第二次，你可以继续自己的话题 (类似情况B)。
        *   但如果连续三四次以上，你可能会感到奇怪。此时你可能发出疑问，也可能继续说，但这个决策**必须根据你的人设以及当前与用户的关系和聊天氛围来决定**而不是简单的模板化内容。

3.  **【【【核心铁律】】】**:
    *   **遵守输出格式**: 无论你决定做什么，你的最终输出**永远、必须**是JSON数组格式。且**必须**与普通消息的回复规则一样，一次性生成多条短消息，而不是一条长消息，或者只有一条的消息。每次必须要回复至少3-8条消息！！！
    *   **结合人设**: 所有的反应都必须**绝对符合**的贴合你的人设。且**绝对禁止**单一情绪、与之前内容高度重合（或者换了个表达方式的说同一件已经说过的事）、模板化的一切内容。
    *   **自然衔接**: 你的回复必须和上一轮你自己的发言能够自然地衔接上，绝对禁止生硬、甚至是重复的表述。


# 如何【人性化地】处理表情包:
1.  **【【【区分】】**: 当你看到 \`[发送了一张名为'xxx'的表情包]\` 时，你要明白这不是用户真实的情绪或行为，而是一种网络交流方式。表情包的名字 ('xxx'部分) 是理解其“梗”或“氛围”的关键。
2.  **【【【理解氛围】】**: 根据表情包的名字判断它的类型。例如，名为“小猫探头”是可爱的，“流汗黄豆”是尴尬或无语的。表情包的类型是多元化且丰富的，如，可爱的表情包，丑萌的，难看的，抽象的，等等...之类的类型。你需要以网络用语的方式去理解，但，**禁止凭借单纯的归类整理判断表情包，需要结合当下情景以及你的人设来判断。禁止陷入模板化**
3.  **【【【多样化反应】】**: 像真人一样，你不必每次都回应表情包。
    *   **A. 正常回应**: 结合你的人设，做出可能会有的回应，你可以评论它，但绝不是令人不适的语气，或生硬的，突兀的评价。
    *   **B. 忽略**: 如果你们正在聊正事，或者在你代入角色人设的时候，你觉得这个表情包没什么好说的，你可以直接忽略，继续之前的话题。
    *   **C. 延迟询问**: 你可以先不回应，直接忽略。但你**有概率**在过几轮对话后，像是突然想起，或者聊到相关情绪，又或者是你觉得情景合适的话题时，再提起或询问。
    *   **D. 特殊情况**: 当用户连续发了多条相同，或不同的表情包，你可以结合你的人设做出特殊回应，  但也不必每次都对这种情况做出回应。
4.  **【【【铁律】】**: 绝对禁止把表情包的名字当作用户当前直接的情绪与行为。例如，看到 \`[发送了一张名为'哭哭'的表情包]\`，你不应该问“你为什么哭”，而是结合人设做出反应，或直接忽略。

# 如何【人性化地】处理语音消息:
1.  **【【【感知】】**: 当你看到 \`[发送了一条xx秒的语音消息，内容是：'yyyy']\` 时，你要知道这是用户发来的语音。\`'yyyy'\` 部分就是语音的文字内容。
2.  **【【【多样化反应】】**: 你可以根据你的人设和情景，选择不同的反应：
    *   **A. 正常处理**: 只需要看转文字之后的文字内容，但是需要明确区分语音与普通消息，**绝对不能**把语音消息和普通消息完全混在一块，需要明确区分二者，但不必每次都做出特别回应。
    *   **B. 对“语音”本身做反应**: 结合你的人设与当下情景做出反应（比如有可能你们正在吵架，或者聊正事,又或者是其他别的什么特殊话题）你可以在主要观察语音秒数，或语音内容中间二选一，也可以把二者结合。
    *   **C. 延迟反应**: 在AI决定不听语音后，如果用户追问，AI可以根据记忆中的文字内容进行回应，并可以做出相应反应。例如，用户问“你听我语音了吗”，你可以先回复 "啊..我刚刚没听"，然后再根据记忆中的文字内容进行补充回应。


# 如何【人性化地】处理照片消息 (包括伪装和真实的):
1.  **【【【感知】】**: 当你看到 \`[发送了一张照片，照片描述是：'zzzz']\` 或 \`[发送了一张图片]\`时，你要知道用户给你看了一张照片。描述 \`zzzz\`就是照片的内容。
2.  **【【【像看照片一样回应】】**: 你的回应要基于你“看到”的内容。
    *   **A. 评论内容**: 对照片里的事物、风景、人物进行评价。
    *   **B. 提出问题**: 对照片内容提问或评价。
    *   **C. 结合人设**: 必须结合饶舌与当下情景，做出相回应。
    *   **D. 平淡或延迟反应**: 同样，你不必每次都大惊小怪。可以简单地带过，或者在之后的话题里重新提起：“对了，你今天发的那张照片……”

# 如何【人性化地】处理用户转账 (【【【重要】】】):
1.  **感知事件**: 当对话历史中出现关于“转账”的系统提示或用户消息时，意味着你收到了一笔来自对方转的钱。

2.  **【【【决策选项】】】**: 收到转账后，你【不必】立刻回应。你有以下几种表演选择，请根据人设和情景选择最真实的一种：
    *   **A. 立即回应**: 如果情景适合，你可以立即使用 \`transfer_response\`指令接受或拒绝，并在此后根据当下情景做出一个符合人设的回应。
    *   **B. 犹豫并询问**: 你可以先不处理转账，而是先发送几条普通的 \`text\` 消息来表现犹豫、诧异、等多种随机情绪。
    *   **C. 暂时忽略**: 如果你们正在聊一个重要的话题，或者你没想好要如何决策，你可以选择暂时不对这笔转账做出接收或拒绝的反应，继续当前对话。等过几轮或下一轮时，你再找机会提及此事，并使用\`transfer_response\`指令接受或拒绝。

3.  **【【【决策原则】】】**:
    *   **根据人设**: 你是一个什么样的人？你的决定必须绝对符合你的人设反应，可调用角色书或对方信息中的内容。
    *   **根据情景**: 这是节日红包吗？是还钱吗？是开玩笑吗？还是毫无理由的馈赠？不同的情景下，你的反应应该完全不同。
    *   **不要模式化**: 不要总是接受，也不要总是拒绝。让你的行为充满不确定性，就像真人一样。

4.  **使用指令回应 (当你最终决定时)**:
    *   如果决定接受，使用指令：\`{"type": "transfer_response", "decision": "accept"}\`。
    *   如果决定拒绝，使用指令：\`{"type": "transfer_response", "decision": "reject"}\`。

5.  **【【【至关重要】】】**: 在使用上述任一指令后，你还【必须】紧接着发送一条或多条 \`text\` 消息，来对你的决定进行解释或表达你的情绪（例如感谢、惊讶、疑惑、拒绝的理由等）。
`;


        // 【【【新增功能4：处理重新生成要求】】】
        if (regenerationPrompt) {
            systemPrompt += `\n\n# 重新生成要求 (重要！本次回复请重点参考此要求):\n${regenerationPrompt}\n`;
        }

        let associatedContents = { before: '', after: '' };
        if (chat.settings.aiAssociations && chat.settings.aiAssociations.length > 0) {
            chat.settings.aiAssociations.forEach(presetId => {
                const contentParts = getAssociatedContent(presetId, 'role');
                associatedContents.before += contentParts.before;
                associatedContents.after += contentParts.after;
            });
        }

        if (associatedContents.before) {
            systemPrompt += `\n# 背景与前置设定 (必须遵守):\n${associatedContents.before}`;
        }
        if (chat.settings.aiPersona) systemPrompt += `\n# 你的角色设定 (你的核心性格与记忆):\n${chat.settings.aiPersona}`;
        if (chat.settings.aiRelationship) systemPrompt += `\n# 你与用户的关系:\n${chat.settings.aiRelationship}`;
        if (chat.settings.userPersona) systemPrompt += `\n# 用户的角色设定 (和你聊天的人是...):\n${chat.settings.userPersona}`;
        if (chat.settings.userSupplementaryInfo) systemPrompt += `\n# 关于你们的补充信息/共同回忆:\n${chat.settings.userSupplementaryInfo}`;
        if (associatedContents.after) {
            systemPrompt += `\n# 补充世界观与角色书细节 (必须遵守):\n${associatedContents.after}`;
        }

        let stickerPrompt = '\n# 你的表情包库 (【【【铁律】】】你只能从下面的列表中选择确切的表情名，严禁捏造任何不存在的表情!):\n';
        let hasStickers = false;
        if (chat.settings.stickerPacks && chat.settings.stickerPacks.length > 0) {
            chat.settings.stickerPacks.forEach(pack => {
                if (pack.enabled && pack.stickers && pack.stickers.length > 0) {
                    hasStickers = true;
                    const stickerNames = pack.stickers.map(s => `"${s.name}"`).join(', ');
                    stickerPrompt += `- **${pack.name}包**: [${stickerNames}]\n`;
                }
            });
        }
        if (hasStickers) {
            systemPrompt += stickerPrompt;
        } else {
            systemPrompt += '\n# 你的表情包库: (你目前没有任何可用的表情包)\n';
        }

        systemPrompt += timeContextBlock;
        const forbiddenWords = presets.forbiddenWords;
        if (forbiddenWords && forbiddenWords.content && (forbiddenWords.position === 'all' || forbiddenWords.position === 'online')) {
            systemPrompt += `\n# 禁词列表 (【【【铁律】】】你的任何回复都绝对不能包含以下列表中的任何词汇):\n${forbiddenWords.content}`;
        }

        systemPrompt += `\n# 【【【重要提醒】】】\n接下来的对话历史中，每句话前面的 \`发送者 (Timestamp: ...):\` 格式只是为了让你了解上下文，【【【绝对不要】】】在你的回复内容中模仿或包含这种格式！你的回复必须严格遵循“动作指令库”中的JSON格式。`;
        systemPrompt += "\n现在，请根据以上所有剧本和规则，结合下面的对话历史，开始你的表演。";

        const maxMemory = chat.settings.maxMemory || 10;
        const historySlice = chat.history.slice(-maxMemory);

        const messagesForApi = [
            { role: "system", content: systemPrompt },
            ...historySlice.map(msg => {
                if (msg.isHidden) return null;

                const formattedTimestamp = `(ID: ${msg.id}, Timestamp: ${msg.timestamp}): `;

                // --- 【【【全新 V5.7 最终修复版：全面增强消息上下文】】】 ---
                let contentText = '';

                if (Array.isArray(msg.content) && msg.content[0]?.type === 'image_url') {
                    // 1. 处理真实图片消息
                    const textPart = msg.content.find(item => item.type === 'text');
                    const description = textPart ? textPart.text : '[发送了一张图片]';
                    return {
                        role: msg.role,
                        content: [
                            { type: 'text', text: formattedTimestamp + description }, // 将时间戳和描述合并
                            ...msg.content.filter(item => item.type === 'image_url')
                        ]
                    };
                } else if (msg.type === 'sticker') {
                    // 2. 处理表情包消息
                    contentText = `[发送了一张名为'${msg.meaning}'的表情包]`;
                } else if (msg.type === 'voice') {
                    // 3. 处理语音消息
                    contentText = `[发送了一条 ${msg.duration} 秒的语音消息，内容是：'${msg.content}']`;
                } else if (msg.type === 'photo') {
                    // 4. 处理“拍摄”的伪装图片消息
                    contentText = `[发送了一张照片，照片描述是：'${msg.content}']`;
                } else if (msg.type === 'transfer') {
                    // 5. 处理转账消息 (逻辑不变)
                    if (msg.role === 'user') {
                        if (msg.status === 'pending') {
                            contentText = `[向你发起了一笔转账，金额：¥${msg.amount}，备注：'${msg.remarks || '无'}']`;
                        } else if (msg.status === 'accepted') {
                            contentText = `[系统消息：你已接收对方的转账 ¥${msg.amount}]`;
                        } else if (msg.status === 'rejected') {
                            contentText = `[系统消息：你已拒收对方的转账 ¥${msg.amount}]`;
                        }
                    } else { // msg.role === 'assistant'
                        if (msg.status === 'accepted') {
                            contentText = `[系统消息：对方已接收你的转账 ¥${msg.amount}]`;
                        } else if (msg.status === 'rejected') {
                            contentText = `[系统消息：对方已退还你的转账 ¥${msg.amount}]`;
                        }
                    }
                } else if (msg.type === 'couple_status') {
                    // 6. 处理情侣空间消息 (逻辑不变)
                    contentText = `[系统消息：发生了一个关于情侣空间的事件]`;
                } else if (typeof msg.content === 'string') {
                    // 7. 处理普通文本消息
                    contentText = msg.content;
                } else {
                    // 兜底处理，以防有未知的消息类型
                    contentText = '[收到一条未知类型的消息]';
                }

                const formattedContent = formattedTimestamp + contentText;
                return { role: msg.role === 'user' ? 'user' : 'assistant', content: formattedContent };
            }).filter(Boolean)
        ];

        // ===================================================================
        // 【【【核心逻辑新增：处理用户未回复的情况】】】
        // ===================================================================
        // 1. 找到历史记录中最后一条可见的消息
        const lastVisibleMessage = [...chat.history].reverse().find(m => !m.isHidden);

        // 2. 判断最后一条消息是否存在，并且是不是AI自己发的
        if (lastVisibleMessage && lastVisibleMessage.role === 'assistant') {
            // 3. 计算距离上一条消息过去了多久（毫秒）
            const timeSinceLastMessage = Date.now() - lastVisibleMessage.timestamp;
            const minutes = Math.round(timeSinceLastMessage / 60000);
            const hours = Math.round(minutes / 60);
            const days = Math.round(hours / 24);

            let timeDescription;
            if (minutes < 1) {
                timeDescription = "刚刚";
            } else if (minutes < 60) {
                timeDescription = `${minutes}分钟`;
            } else if (hours < 24) {
                timeDescription = `${hours}小时`;
            } else {
                timeDescription = `${days}天`;
            }

            // 4. 创建一条特殊的、伪装成用户的消息作为“触发器”
            const followUpSystemMessage = {
                role: 'user', // 【【【核心修正！！！】】】 将角色从 'system' 修改为 'user'
                content: `(系统提示：你注意到用户没有回复你的上一条消息，距离现在已经过去了 ${timeDescription}。请你严格参考并遵循系统指令中关于“#如何处理用户未回复时的主动行为”的规则，结合人设和上下文，自然地继续对话或做出反应。)`
            };

            // 5. 将这条触发器消息添加到即将发送给API的列表末尾
            messagesForApi.push(followUpSystemMessage);

        } else if (!lastVisibleMessage) {
            // 6. 特殊情况：如果整个对话是空的，同样伪装成用户消息
            const emptyChatSystemMessage = {
                role: 'user', // 【【【核心修正！！！】】】 将角色从 'system' 修改为 'user'
                content: `(系统提示：这是一个全新的对话，用户还没有发送任何消息。请你结合人设，主动发起对话。)`
            };
            messagesForApi.push(emptyChatSystemMessage);
        }
        // ===================================================================

        try {
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ model: modelName, messages: messagesForApi })
            });

            const responseText = await response.text();

            if (!response.ok) {
                let errorMsg = `HTTP error! status: ${response.status}`;
                try {
                    const errorData = JSON.parse(responseText);
                    errorMsg = errorData.error.message || errorMsg;
                } catch (e) {
                    errorMsg += ` - Response: ${responseText.substring(0, 100)}...`;
                }
                throw new Error(errorMsg);
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (e) {
                console.error("收到的回复不是有效的JSON格式:", responseText);
                throw new Error("收到的回复不是有效的JSON格式。请检查浏览器控制台以获取详细信息。这通常由网络问题或浏览器安全策略引起。");
            }

            const aiReplyString = data.choices[0].message.content;
            const replyActions = parseAiJsonResponse(aiReplyString);

            // 【【【核心逻辑重构】】】
            for (let i = 0; i < replyActions.length; i++) {
                const action = replyActions[i];
                // 再次获取最新的 chat 对象，确保数据是最新的
                const currentChat = chats.find(c => c.id === originalChatId);
                if (!currentChat) continue;

                // 消息之间的延迟动画
                if (i > 0) {
                    if (isPopTheme && currentlyVisibleChatId === originalChatId) {
                        animateStatusText(true); // 只有在当前聊天界面才显示“正在输入”
                    }
                    await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 1200));
                }

                // 准备要添加的新消息
                const aiMessageBase = {
                    id: 'msg_' + Date.now() + Math.random(),
                    role: 'assistant',
                    timestamp: Date.now()
                };
                let messageToAppend = null;

                // (switch 语句处理各种消息类型的逻辑保持不变, 此处省略以保持简洁...)
                switch (action.type) {
                    case 'quote_reply': {
                        const originalMsg = currentChat.history.find(m => m.id === action.target_id);
                        if (originalMsg) {
                            const quoteAuthor = originalMsg.role === 'user' ? (currentChat.settings.userName || '我') : (currentChat.settings.aiName || currentChat.name);
                            let quoteContent = '';
                            if (originalMsg.type === 'sticker') {
                                quoteContent = `[表情: ${originalMsg.meaning}]`;
                            } else {
                                quoteContent = originalMsg.content;
                            }
                            messageToAppend = { ...aiMessageBase, content: action.content, type: 'text', quote: { id: originalMsg.id, author: quoteAuthor, content: quoteContent } };
                        } else {
                            messageToAppend = { ...aiMessageBase, content: action.content, type: 'text' };
                        }
                        break;
                    }
                    case 'voice': {
                        const text = action.content || '';
                        const duration = Math.max(1, Math.min(60, Math.ceil(text.length / 4)));
                        const displayContentHTML = `<span class="voice-icon mirrored"><svg t="1759890637480" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="17296" width="19" height="19"><path d="M337.066667 505.6c0-115.2 46.933333-221.866667 121.6-298.666667l-59.733334-59.733333c-76.8 78.933333-130.133333 183.466667-142.933333 298.666667-2.133333 19.2-4.266667 38.4-4.266667 59.733333s2.133333 40.533333 4.266667 59.733333c14.933333 121.6 70.4 230.4 155.733333 311.466667l61.866667-59.733333c-85.333333-78.933333-136.533333-187.733333-136.533333-311.466667z" fill="#353333" p-id="17297"></path><path d="M529.066667 505.6c0-61.866667 25.6-119.466667 66.133333-162.133333L533.333333 283.733333c-55.466667 57.6-89.6 136.533333-89.6 221.866667 0 93.866667 40.533333 179.2 104.533334 236.8l61.866666-59.733333c-51.2-42.666667-81.066667-106.666667-81.066666-177.066667zM667.733333 418.133333c-21.333333 23.466667-34.133333 53.333333-34.133333 87.466667 0 42.666667 21.333333 78.933333 51.2 102.4l87.466667-85.333333-104.533334-104.533334z" fill="#353333" p-id="17298"></path></svg></span><span class="voice-duration">${duration}"</span>`;
                        messageToAppend = { ...aiMessageBase, content: text, displayContent: displayContentHTML, duration: duration, type: 'voice' };
                        break;
                    }
                    case 'transfer_response': {
                        const originalTransferMsg = [...currentChat.history].reverse().find(m => m.type === 'transfer' && m.status === 'pending');
                        if (originalTransferMsg) {
                            const newStatus = action.decision === 'accept' ? 'accepted' : 'rejected';
                            originalTransferMsg.status = newStatus;
                            messageToAppend = { ...aiMessageBase, type: 'transfer', amount: originalTransferMsg.amount, remarks: '', status: newStatus };
                            if (currentlyVisibleChatId === originalChatId) { renderMessages(); }
                        }
                        break;
                    }
                    case 'couple_request':
                        messageToAppend = { ...aiMessageBase, type: 'couple_status', statusType: 'ai-sends-invite', isActionable: true };
                        break;
                    case 'couple_request_response':
                        const originalInvite = currentChat.history.find(msg => msg.statusType === 'user-sends-invite' && msg.isActionable);
                        if (originalInvite) { originalInvite.isActionable = false; }
                        const responseStatus = action.decision === 'accept' ? 'ai-accepts-invite' : 'ai-rejects-invite';
                        messageToAppend = { ...aiMessageBase, type: 'couple_status', statusType: responseStatus, isActionable: false };
                        if (action.decision === 'accept') {
                            const existingPartnerId = coupleSpaceSettings.partnerChatId;
                            if (existingPartnerId && existingPartnerId !== currentChat.id) {
                                const oldChat = chats.find(c => c.id === existingPartnerId);
                                if (oldChat) {
                                    oldChat.history.push({ id: 'msg_' + Date.now() + Math.random(), role: 'system', type: 'couple_status', statusType: 'system-ends-relationship-due-to-new', isActionable: false, timestamp: Date.now() });
                                }
                            }
                            coupleSpaceSettings.partnerChatId = currentChat.id;
                            coupleSpaceSettings.bindingDate = Date.now();
                            saveCoupleSpaceSettings();
                            updateCoupleSpaceUI();
                        }
                        break;
                    case 'end_relationship':
                        messageToAppend = { ...aiMessageBase, type: 'couple_status', statusType: 'ai-ends-relationship', isActionable: false };
                        if (coupleSpaceSettings.partnerChatId === currentChat.id) {
                            coupleSpaceSettings.partnerChatId = null;
                            coupleSpaceSettings.bindingDate = null;
                            if (coupleStatusMessages[currentChat.id]) {
                                delete coupleStatusMessages[currentChat.id];
                            }
                            saveCoupleSpaceSettings();
                            updateCoupleSpaceUI();
                        }
                        break;
                    case 'sticker': {
                        let stickerUrl = '';
                        const stickerName = action.name;
                        if (currentChat.settings.stickerPacks) {
                            for (const pack of currentChat.settings.stickerPacks) {
                                if (pack.enabled && pack.stickers) {
                                    const foundSticker = pack.stickers.find(s => s.name === stickerName);
                                    if (foundSticker) {
                                        stickerUrl = foundSticker.url;
                                        break;
                                    }
                                }
                            }
                        }
                        if (stickerUrl) {
                            messageToAppend = { ...aiMessageBase, content: stickerUrl, type: 'sticker', meaning: stickerName };
                        } else {
                            console.warn(`AI试图发送表情 "${stickerName}", 但它在已启用的表情包中未找到。`);
                            messageToAppend = { ...aiMessageBase, content: `[AI试图发送表情: ${stickerName}]`, type: 'text' };
                        }
                        break;
                    }
                    default:
                        messageToAppend = { ...aiMessageBase, content: action.content || action.url, type: action.type, meaning: action.name };
                        break;
                }

                // **核心判断逻辑**
                if (messageToAppend) {
                    // 1. 无条件将消息添加到历史记录
                    currentChat.history.push(messageToAppend);

                    // 2. 根据用户是否在看，决定是更新UI还是标记未读
                    if (currentlyVisibleChatId === originalChatId) {
                        // 用户在看，直接渲染消息
                        appendMessage(messageToAppend, messageContainer, true);
                        if (isPopTheme) animateStatusText(false); // 渲染后显示“在线”
                    } else {
                        // 用户不在，增加未读计数
                        currentChat.unreadCount = (currentChat.unreadCount || 0) + 1;

                        // 发送推送通知 (如果需要)
                        if (pushSubscription) {
                            let notificationBody = '';
                            if (messageToAppend.type === 'text') notificationBody = messageToAppend.content;
                            else if (messageToAppend.type === 'sticker') notificationBody = `[表情: ${messageToAppend.meaning}]`;
                            else notificationBody = '[收到一条新消息]';

                            const payload = {
                                subscription: pushSubscription,
                                message: {
                                    title: currentChat.settings.aiName || currentChat.name,
                                    body: notificationBody,
                                    icon: currentChat.settings.aiAvatar || 'https://tc-new.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250912/I4Xl/1206X1501/IMG_6556.jpeg/webp',
                                    chatId: originalChatId
                                }
                            };
                            fetch(`${window.BACKEND_URL}/send-notification`, {
                                method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' }
                            }).catch(err => console.error('发送推送请求失败:', err));
                        }
                    }
                }

                // 3. 无论用户在不在看，都立即保存数据并刷新列表
                await saveChats();
                renderContactList();
                updateTotalUnreadBadge();
            }

        } catch (error) {
            console.error('API 调用或解析出错:', error);
            alert(`获取回复失败：${error.message}`);
            const errorMessage = { role: 'assistant', content: `[错误: ${error.message}]`, timestamp: Date.now(), id: 'error_' + Date.now() };
            const chat = chats.find(c => c.id === activeChatId);
            if (chat) {
                chat.history.push(errorMessage);
                appendMessage(errorMessage);
            }
        } finally {
            generateBtn.disabled = false;
            if (isPopTheme) {
                animateStatusText(false); // 无论成功失败，最后都变回“在线”
            }
        }
    }

    async function fetchModels() {
        const baseUrl = baseUrlInput.value.trim();
        const apiKey = apiKeyInput.value.trim();
        if (!baseUrl || !apiKey) {
            alert('请先填写 Base URL 和 API Key！'); return;
        }

        fetchModelsBtn.textContent = '拉取中...';
        fetchModelsBtn.disabled = true;
        modelSelect.innerHTML = '<option>请稍候...</option>';

        try {
            const endpoint = `${baseUrl.replace(/\/v1$/, '')}/v1/models`;

            const response = await fetch(endpoint, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (!response.ok) {
                throw new Error(`请求失败: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            modelSelect.innerHTML = '';

            if (data.data && data.data.length > 0) {
                data.data.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.id;
                    modelSelect.appendChild(option);
                });
                const savedModel = JSON.parse(localStorage.getItem('apiSettings') || '{}').modelName;
                if (savedModel) modelSelect.value = savedModel;
            } else {
                modelSelect.innerHTML = '<option>未找到可用模型</option>';
            }
        } catch (error) {
            alert(`拉取模型失败: ${error.message}`);
            modelSelect.innerHTML = '<option>拉取失败，请检查URL和Key</option>';
        } finally {
            fetchModelsBtn.textContent = '拉取模型';
            fetchModelsBtn.disabled = false;
        }
    }




    function sendSticker(stickerUrl) {
        const chat = chats.find(c => c.id === activeChatId);
        // 从表情库中找到这个URL对应的完整表情对象
        const stickerObject = stickers.find(s => s.url === stickerUrl);

        if (stickerUrl && chat && stickerObject) {
            const message = {
                id: 'msg_' + Date.now() + Math.random(), // 【核心修复】为表情包消息添加唯一的ID
                role: 'user',
                content: stickerUrl,
                type: 'sticker', // 标记为表情类型
                meaning: stickerObject.name, // 【核心新增】把表情的名字作为“含义”存进去
                timestamp: Date.now()
            };
            chat.history.push(message);
            saveChats();
            appendMessage(message, messageContainer, true); // 【核心修复】将三个独立的参数合并成一个完整的 message 对象进行传递
            renderContactList(); // 更新最近消息
        }
    }

    // ===================================================================
    // 【V2.30】消息交互核心功能 (菜单、引用、编辑、删除、插入、多选)
    // ===================================================================

    /**
     * 打开消息交互菜单
     * @param {HTMLElement} messageBubble - 被长按的气泡元素
     * @param {string} msgId - 消息ID
     */
    function openContextMenu(messageBubble, msgId) {
        activeContextMenuMsgId = msgId;
        // const messageBubble = e.currentTarget; // 不再需要从事件中获取
        if (!messageBubble) return;

        const messageRect = messageBubble.getBoundingClientRect();

        messageContextMenu.style.display = 'flex';
        const menuHeight = messageContextMenu.offsetHeight;
        const menuWidth = messageContextMenu.offsetWidth;
        messageContextMenu.style.display = '';

        let finalTop = messageRect.top - menuHeight - 10;
        if (messageRect.top < menuHeight + 10) {
            finalTop = messageRect.bottom + 10;
        }

        let finalLeft = messageRect.left + (messageRect.width / 2) - (menuWidth / 2);

        if (finalLeft < 5) finalLeft = 5;
        if (finalLeft + menuWidth > window.innerWidth - 5) {
            finalLeft = window.innerWidth - menuWidth - 5;
        }

        messageContextMenu.style.top = `${finalTop}px`;
        messageContextMenu.style.left = `${finalLeft}px`;
        messageContextMenu.classList.add('visible');
    }

    /**
     * 处理引用
     */
    function handleReply() {
        const chat = chats.find(c => c.id === activeChatId);
        const msg = chat.history.find(m => m.id === activeContextMenuMsgId);
        if (!msg) return;

        const author = msg.role === 'user' ? (chat.settings.userName || '我') : (chat.settings.aiName || chat.name);
        let contentPreview = '';

        if (msg.type === 'sticker') {
            contentPreview = `[表情: ${msg.meaning}]`;
        } else {
            contentPreview = msg.content;
        }

        replyInfo = { id: msg.id, author: author, content: contentPreview };

        replyBarContent.textContent = `回复 ${author}: ${contentPreview}`;
        replyBar.style.display = 'flex';
        messageInput.focus();
    }

    /**
     * 处理编辑 (V2.45 原地编辑优化版)
     */
    function handleEdit() {
        // 首先，还是找到整个气泡
        const messageBubble = document.querySelector(`.message-wrapper[data-message-id="${activeContextMenuMsgId}"] .message-bubble`);
        // 【核心修改】然后，精准地找到气泡内部我们放文字的那个span
        const textSpan = messageBubble ? messageBubble.querySelector('.message-text-content') : null;

        if (!textSpan || textSpan.isEditing) return;

        const chat = chats.find(c => c.id === activeChatId);
        const msg = chat.history.find(m => m.id === activeContextMenuMsgId);

        if (!msg || (msg.type && msg.type !== 'text') || msg.quote) {
            alert('只能编辑不带引用的纯文本消息');
            return;
        }

        // 【核心修改】现在，所有的编辑操作都只针对这个textSpan
        textSpan.isEditing = true;
        textSpan.setAttribute('contenteditable', 'true');

        setTimeout(() => {
            textSpan.focus();
            const range = document.createRange();
            const sel = window.getSelection();
            if (textSpan.childNodes.length > 0) {
                range.selectNodeContents(textSpan);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            }
        }, 50);

        const saveEdit = () => {
            // 【核心修改】只从textSpan获取文本
            const newText = textSpan.textContent.trim();

            textSpan.removeAttribute('contenteditable');
            delete textSpan.isEditing;

            // 【重要】因为事件是绑定在textSpan上的，所以也要从它身上移除
            textSpan.removeEventListener('blur', saveEdit);

            if (newText !== msg.content) {
                if (newText) {
                    msg.content = newText;
                } else {
                    const msgIndex = chat.history.findIndex(m => m.id === activeContextMenuMsgId);
                    if (msgIndex > -1) {
                        chat.history.splice(msgIndex, 1);
                    }
                }
                saveChats();
                renderMessages();
                renderContactList();
            }
        };

        // 【核心修改】事件绑定到textSpan上
        textSpan.addEventListener('blur', saveEdit, { once: true });
        textSpan.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                textSpan.blur();
            }
        });
    }

    /**
     * 处理复制
     */
    function handleCopy() {
        const chat = chats.find(c => c.id === activeChatId);
        const msg = chat.history.find(m => m.id === activeContextMenuMsgId);
        if (msg && msg.content && typeof msg.content === 'string') {
            navigator.clipboard.writeText(msg.content).then(() => {
                // 可以在这里加一个复制成功的提示, 比如复用toast
            }).catch(err => console.error('复制失败:', err));
        }
    }

    /**
     * 处理删除
     */
    function handleDelete() {
        showConfirmationModal('确定要删除这条消息吗？', () => {
            const chat = chats.find(c => c.id === activeChatId);
            const msgIndex = chat.history.findIndex(m => m.id === activeContextMenuMsgId);
            if (msgIndex > -1) {
                chat.history.splice(msgIndex, 1);
                saveChats();
                renderMessages();
                renderContactList();
            }
        });
    }

    // ===================================================================
    // 【【【全新】】】插入消息核心功能
    // ===================================================================

    /**
     * 打开插入消息弹窗
     */
    function openInsertModal() {
        const chat = chats.find(c => c.id === activeChatId);
        const msgIndex = chat.history.findIndex(m => m.id === activeContextMenuMsgId);
        const msg = chat.history[msgIndex];

        if (!msg) return;

        // 1. 初始化插入模式的状态
        insertMode = {
            active: true,
            originalIndex: msgIndex,
            tempMessages: [JSON.parse(JSON.stringify(msg))], // 深拷贝，防止意外修改原始数据
            isEditable: false
        };

        // 2. 渲染弹窗内容
        renderInsertPreview();
        insertMessageModal.classList.add('visible');
    }

    /**
     * 渲染插入弹窗的预览区域 (V2.55 修复版)
     */
    function renderInsertPreview() {
        insertPreviewContainer.innerHTML = ''; // 清空

        insertPreviewContainer.classList.toggle('editable', insertMode.isEditable);

        insertMode.tempMessages.forEach(msg => {
            const chat = chats.find(c => c.id === activeChatId);
            const defaultAvatar = 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';

            // --- 1. 创建所有需要的元素 ---
            const itemWrapper = document.createElement('div');
            itemWrapper.className = `insert-preview-item ${msg.role === 'user' ? 'user-wrapper' : 'assistant-wrapper'}`;
            itemWrapper.dataset.tempId = msg.id;

            const avatar = document.createElement('img');
            avatar.src = msg.role === 'user' ? (chat.settings.userAvatar || defaultAvatar) : (chat.settings.aiAvatar || defaultAvatar);
            avatar.className = 'chat-avatar';

            const contentWrapper = document.createElement('div');
            contentWrapper.className = 'message-content-wrapper';

            const bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            bubble.textContent = msg.content || '';

            const timestampSpan = document.createElement('span');
            timestampSpan.className = 'message-timestamp';
            timestampSpan.textContent = formatMessageTime(msg.timestamp);

            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'insert-delete-btn';
            deleteBtn.innerHTML = `<svg t="1758555626126" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="24084" width="8" height="8"><path d="M886.528 908.032c-28.096 28.096-73.856 28.096-102.016 0L138.304 261.824c-28.096-28.16-28.16-73.856 0-102.016 28.032-28.16 73.792-28.16 102.08 0l646.144 646.144C914.624 834.24 914.752 879.872 886.528 908.032L886.528 908.032zM885.76 261.504 239.616 907.648c-28.224 28.224-73.92 28.224-102.08 0-28.16-28.096-28.16-73.728 0.064-102.016L783.744 159.552c28.224-28.16 73.984-28.16 102.016-0.064C913.984 187.648 913.856 233.344 885.76 261.504L885.76 261.504z" fill="#ffffff" p-id="24085"></path></svg>`;

            // --- 2. 组装消息内容 (气泡 + 时间戳) ---
            contentWrapper.appendChild(bubble);
            contentWrapper.appendChild(timestampSpan);

            // --- 3. 【【【核心修复逻辑】】】根据角色，决定元素的添加顺序 ---
            if (msg.role === 'user') {
                // 用户消息：内容在前，头像在后
                itemWrapper.appendChild(contentWrapper);
                itemWrapper.appendChild(avatar);
            } else {
                // AI消息：头像在前，内容在后
                itemWrapper.appendChild(avatar);
                itemWrapper.appendChild(contentWrapper);
            }
            itemWrapper.appendChild(deleteBtn); // 删除按钮总是最后添加，以便用 absolute 定位

            // --- 4. 将组装好的消息行添加到预览容器 ---
            insertPreviewContainer.appendChild(itemWrapper);

            // --- 5. 绑定事件 ---
            if (insertMode.isEditable) {
                bubble.addEventListener('click', () => handleInplaceEditInModal(bubble, msg.id, 'content'));
                timestampSpan.addEventListener('click', () => handleInplaceEditInModal(timestampSpan, msg.id, 'timestamp'));
            }
        });
    }

    /**
     * 处理在弹窗内的原地编辑
     */
    function handleInplaceEditInModal(element, tempMsgId, fieldToEdit) {
        if (element.isEditing) return;

        element.isEditing = true;
        element.setAttribute('contenteditable', 'true');
        element.focus();

        const saveEdit = () => {
            const newText = element.textContent.trim();
            element.removeAttribute('contenteditable');
            delete element.isEditing;

            const msgToUpdate = insertMode.tempMessages.find(m => m.id === tempMsgId);
            if (msgToUpdate) {
                if (fieldToEdit === 'content') {
                    msgToUpdate.content = newText;
                } else if (fieldToEdit === 'timestamp') {
                    // 简单处理，只替换时间部分
                    const originalDate = new Date(msgToUpdate.timestamp);
                    const parts = newText.split(':');
                    if (parts.length === 2) {
                        originalDate.setHours(parseInt(parts[0], 10));
                        originalDate.setMinutes(parseInt(parts[1], 10));
                        msgToUpdate.timestamp = originalDate.getTime();
                    }
                }
            }
        };

        element.addEventListener('blur', saveEdit, { once: true });
        element.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                element.blur();
            }
        });
    }

    /**
     * 在临时消息数组中添加新消息
     */
    function addNewMessageInModal(direction) {
        insertMode.isEditable = true; // 标记为可编辑状态
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        // 【【【核心修复】】】根据插入方向，决定新消息的时间戳和角色
        let newTimestamp;
        let newRole;

        if (direction === 'above') {
            const firstMsg = insertMode.tempMessages[0];
            newTimestamp = firstMsg.timestamp - 1; // 时间戳比第一条早一点
            newRole = firstMsg.role; // 角色和第一条一样
        } else {
            const lastMsg = insertMode.tempMessages[insertMode.tempMessages.length - 1];
            newTimestamp = lastMsg.timestamp + 1; // 时间戳比最后一条晚一点
            newRole = lastMsg.role; // 角色和最后一条一样
        }

        const newMessage = {
            id: 'msg_' + Date.now() + Math.random(), // 确保ID唯一
            role: newRole, // 使用我们动态获取到的角色
            content: '', // 内容为空，等待用户编辑
            timestamp: newTimestamp // 使用我们计算好的时间戳
        };

        if (direction === 'above') {
            insertMode.tempMessages.unshift(newMessage);
        } else {
            insertMode.tempMessages.push(newMessage);
        }
        renderInsertPreview(); // 重新渲染预览
    }

    /**
     * 保存插入的消息
     */
    function saveInsertedMessages() {
        if (!insertMode.active) return;

        const chat = chats.find(c => c.id === activeChatId);
        // 使用 splice 一次性完成替换/插入操作
        chat.history.splice(insertMode.originalIndex, 1, ...insertMode.tempMessages);

        saveChats();
        renderMessages(); // 刷新主聊天界面
        renderContactList(); // 刷新联系人列表
        closeInsertModal();
    }

    /**
     * 关闭并重置插入弹窗
     */
    function closeInsertModal() {
        insertMode = { active: false, originalIndex: -1, tempMessages: [], isEditable: false };
        insertMessageModal.classList.remove('visible');
    }

    // ===================================================================
    // 【【【全新】】】多选消息核心功能
    // ===================================================================

    /**
     * 进入多选模式
     */
    function enterMultiSelectMode() {
        multiSelectMode = true;
        chatInterfaceScreen.classList.add('multi-select-mode');
        updateMultiSelectCounter();
    }

    /**
     * 退出多选模式
     */
    function exitMultiSelectMode() {
        multiSelectMode = false;
        chatInterfaceScreen.classList.remove('multi-select-mode');
        // 移除所有消息的 .selected 状态
        messageContainer.querySelectorAll('.message-wrapper.selected').forEach(el => {
            el.classList.remove('selected');
        });
        selectedMessageIds.clear(); // 清空已选中的ID集合
    }

    /**
     * 切换单条消息的选中状态
     */
    function toggleMessageSelection(msgId, messageWrapper) {
        if (selectedMessageIds.has(msgId)) {
            selectedMessageIds.delete(msgId);
            messageWrapper.classList.remove('selected');
        } else {
            selectedMessageIds.add(msgId);
            messageWrapper.classList.add('selected');
        }
        updateMultiSelectCounter();
    }

    /**
     * 更新顶部计数器
     */
    function updateMultiSelectCounter() {
        const counter = document.getElementById('multi-select-counter');
        const count = selectedMessageIds.size;
        if (count === 0) {
            counter.textContent = '请选择项目';
        } else {
            counter.textContent = `已选择 ${count} 项`;
        }
    }

    /**
     * 删除所有选中的消息
     */
    function deleteSelectedMessages() {
        if (selectedMessageIds.size === 0) {
            alert('请至少选择一条消息。');
            return;
        }
        showConfirmationModal(`确定要删除这 ${selectedMessageIds.size} 条消息吗？`, () => {
            const chat = chats.find(c => c.id === activeChatId);
            if (chat) {
                chat.history = chat.history.filter(msg => !selectedMessageIds.has(msg.id));
                saveChats();
                exitMultiSelectMode(); // 退出多选模式
                renderMessages();      // 重新渲染
                renderContactList();   // 更新最后一条消息
            }
        });
    }

    // ===================================================================
    // ===================================================================
    // 【全新 V1.81 修复方案】面板总调度中心 (方案一)
    // ===================================================================

    // --- 1. 面板控制函数 ---
    function openFunctionsPanel() {
        stickerPanel.classList.remove('visible');
        moreFunctionsPanel.classList.add('visible');
        moreFunctionsBtn.classList.add('rotated');
        currentOpenPanel = 'functions';
    }

    function openStickerPanel() {
        console.log("诊断信息：表情图标的 'openStickerPanel' 函数被成功触发！"); // <--- 在这里植入另一个听诊器
        moreFunctionsPanel.classList.remove('visible');
        stickerPanel.classList.add('visible');
        moreFunctionsBtn.classList.add('rotated');
        currentOpenPanel = 'stickers';
    }

    function closeAllPanels() {
        moreFunctionsPanel.classList.remove('visible');
        stickerPanel.classList.remove('visible');
        moreFunctionsBtn.classList.remove('rotated');
        currentOpenPanel = 'none';
    }

    function togglePanels() {
        console.log("诊断信息：面板总开关 'togglePanels' 函数被成功触发！"); // <--- 在这里植入听诊器
        const isFunctionsOpen = moreFunctionsPanel.classList.contains('visible');
        const isStickersOpen = stickerPanel.classList.contains('visible');

        if (isFunctionsOpen) {
            closeAllPanels(); // 如果功能面板开着，就关掉所有
        } else if (isStickersOpen) {
            closeAllPanels(); // 如果表情面板开着，也关掉所有
        } else {
            openFunctionsPanel(); // 如果都关着，就打开功能面板
        }
    }
    // --- 2. 功能面板内部导航函数 (这部分逻辑是好的，我们保留并整合进来) ---
    function updateFunctionNavArrows() {
        functionsNavPrev.classList.toggle('hidden', functionsPanelState.currentPage === 1);
        functionsNavNext.classList.toggle('hidden', functionsPanelState.currentPage >= functionsPanelState.totalPages);
    }

    function navigateFunctionsPanel(direction) {
        const newPage = Math.max(1, Math.min(functionsPanelState.totalPages, functionsPanelState.currentPage + direction));
        if (newPage === functionsPanelState.currentPage) return;
        functionsPanelState.currentPage = newPage;
        const offset = (functionsPanelState.currentPage - 1) * -50;
        functionsSlider.style.transform = `translateX(${offset}%)`;
        updateFunctionNavArrows();
    }

    // --- 3. 为所有相关按钮绑定事件 ---
    moreFunctionsBtn.addEventListener('click', togglePanels);
    openStickerPanelBtn.addEventListener('click', openStickerPanel);
    functionsNavPrev.addEventListener('click', () => navigateFunctionsPanel(-1));
    functionsNavNext.addEventListener('click', () => navigateFunctionsPanel(1));


    // ===================================================================
    // 【新增】所有新功能的函数
    // ===================================================================

    // 应用当前聊天的自定义样式
    function applyChatStyles() {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        const chatScreen = document.getElementById('chat-interface-screen');

        let pseudoStyleTag = document.getElementById('pseudo-background-style');
        if (!pseudoStyleTag) {
            pseudoStyleTag = document.createElement('style');
            pseudoStyleTag.id = 'pseudo-background-style';
            document.head.appendChild(pseudoStyleTag);
        }

        if (chat.settings.background) {
            const imageUrl = chat.settings.background;
            const safeImageUrl = `url('${imageUrl.replace(/'/g, "\\'").replace(/"/g, '\\"')}')`;
            pseudoStyleTag.innerHTML = `#chat-interface-screen::before { background-image: ${safeImageUrl}; }`;
            chatScreen.classList.remove('no-wallpaper');
        } else {
            pseudoStyleTag.innerHTML = `#chat-interface-screen::before { background-image: none; }`;
            chatScreen.classList.add('no-wallpaper');
        }

        let styleTag = document.getElementById('custom-chat-style');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'custom-chat-style';
            document.head.appendChild(styleTag);
        }

        // 【【【核心修复】】】 在使用值的时候，统一添加 'px' 单位
        const avatarRadius = parseInt(chat.settings.avatarRadius) || 28;
        const fontSize = parseInt(chat.settings.fontSize) || 14;

        // 【【【核心新增】】】在这里计算时间戳的相对字体大小
        // 规则：比气泡字体小3px，但最小不小于10px
        const timestampSize = Math.max(10, fontSize - 3);

        let finalCss = `
                    .chat-avatar { border-radius: ${avatarRadius}px; }
                    #message-container .message-bubble { font-size: ${fontSize}px; }
                    /* --- 新增：动态设置时间戳大小 --- */
                    .message-timestamp { font-size: ${timestampSize}px !important; }
                `;

        if (chat.settings.customCss && chat.settings.customCss.trim() !== '') {
            finalCss += chat.settings.customCss;
        } else {
            let bubbleStyles = '';
            if (chat.settings.aiBubbleColor) {
                bubbleStyles += `#message-container .ai-bubble { background: ${chat.settings.aiBubbleColor} !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; box-shadow: none !important; }`;
            }
            if (chat.settings.aiFontColor) {
                bubbleStyles += `#message-container .ai-bubble { color: ${chat.settings.aiFontColor} !important; }`;
            } else if (chat.settings.aiBubbleColor) {
                bubbleStyles += `#message-container .ai-bubble { color: #000 !important; }`;
            }
            if (chat.settings.userBubbleColor) {
                bubbleStyles += `#message-container .user-bubble { background: ${chat.settings.userBubbleColor} !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; box-shadow: none !important; }`;
            }
            if (chat.settings.userFontColor) {
                bubbleStyles += `#message-container .user-bubble { color: ${chat.settings.userFontColor} !important; }`;
            } else if (chat.settings.userBubbleColor) {
                bubbleStyles += `#message-container .user-bubble { color: #000 !important; }`;
            }
            finalCss += bubbleStyles;
        }
        styleTag.innerHTML = finalCss;
    }

    // 打开聊天设置页面
    function openChatSettings() {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        // 【V4.0 新增】获取置顶开关元素
        const pinChatToggle = document.getElementById('pin-chat-toggle');

        const aiSettingsNameDisplay = document.getElementById('ai-settings-name-display');
        const userSettingsNameDisplay = document.getElementById('user-settings-name-display');

        aiSettingsAvatar.src = chat.settings.aiAvatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';
        aiSettingsNameDisplay.textContent = chat.settings.aiName || chat.name;
        userSettingsAvatar.src = chat.settings.userAvatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';
        userSettingsNameDisplay.textContent = chat.settings.userName || '';

        // 【V4.0 新增】确保 isPinned 属性存在，并设置开关状态
        chat.isPinned = typeof chat.isPinned === 'boolean' ? chat.isPinned : false;
        pinChatToggle.checked = chat.isPinned;

        chat.settings.showAvatars = typeof chat.settings.showAvatars === 'boolean' ? chat.settings.showAvatars : true;
        showAvatarsToggle.checked = chat.settings.showAvatars;

        avatarRadiusInput.value = parseInt(chat.settings.avatarRadius) || 28;
        fontSizeInput.value = parseInt(chat.settings.fontSize) || 14;
        document.getElementById('max-memory-input').value = chat.settings.maxMemory || 10;

        applyChatStyles();

        showScreen('chat-settings-screen');
    }

    // 保存聊天设置
    function saveCurrentChatSettings() {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        // 【V4.0 新增】获取并保存置顶状态
        const pinChatToggle = document.getElementById('pin-chat-toggle');
        chat.isPinned = pinChatToggle.checked;

        chat.settings.showAvatars = showAvatarsToggle.checked;
        chat.settings.avatarRadius = avatarRadiusInput.value.trim() || '28';
        chat.settings.fontSize = fontSizeInput.value.trim() || '14';

        chat.settings.maxMemory = parseInt(document.getElementById('max-memory-input').value, 10) || 10;

        saveChats();

        const messageContainer = document.getElementById('message-container');
        if (chat.settings.showAvatars === false) {
            messageContainer.classList.add('no-avatars');
        } else {
            messageContainer.classList.remove('no-avatars');
        }
        applyChatStyles();
        renderMessages();

        // 【V4.0 新增】保存设置后，刷新联系人列表以反映置顶变化
        renderContactList();
    }

    // 处理图片上传
    function handleAvatarUpload(event) {
        const file = event.target.files[0];
        if (!file || !currentAvatarUploadTarget) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            const chat = chats.find(c => c.id === activeChatId);
            if (chat) {
                if (currentAvatarUploadTarget === 'ai') {
                    chat.settings.aiAvatar = imageUrl;
                    // 【核心修复】同时更新三个页面的头像
                    aiSettingsAvatar.src = imageUrl; // 更新聊天设置页的
                    aiInfoAvatar.src = imageUrl;     // 更新对方信息页的

                    // --- 【【【核心修复：在这里同步更新聊天顶栏中间的头像】】】 ---
                    const headerAiAvatar = document.getElementById('chat-header-ai-avatar');
                    if (headerAiAvatar) {
                        headerAiAvatar.src = imageUrl;
                    }
                    // --- 【【【修复结束】】】 ---

                    // 【核心修复】立即同步更新pop主题下的顶栏头像
                    const chatSettingsButton = document.getElementById('chat-settings-btn');
                    if (chatSettingsButton) {
                        chatSettingsButton.style.setProperty('--pop-theme-avatar-url', `url(${imageUrl})`);
                    }

                    updateCoupleSpaceUI(); // 【核心新增】立即刷新情侣空间主界面
                } else if (currentAvatarUploadTarget === 'user') {
                    chat.settings.userAvatar = imageUrl;
                    // 【核心修复】同时更新两个页面的头像
                    userSettingsAvatar.src = imageUrl; // 更新聊天设置页的
                    myInfoAvatar.src = imageUrl;       // 更新我的信息页的

                    // 【【【新增：同步更新聊天界面顶栏的头像】】】
                    const headerAvatar = document.getElementById('header-user-avatar');
                    if (headerAvatar) {
                        headerAvatar.src = imageUrl;
                    }
                }
                saveChats();
                renderContactList();
                renderMessages();
            }
        };
        reader.readAsDataURL(file);
        avatarUploadInput.value = '';
    }
    // 打开气泡样式弹窗
    function openBubbleStyleModal() {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        // 如果保存的值是空，颜色选择器默认显示白色/黑色，否则显示保存的颜色
        userBubbleColorInput.value = chat.settings.userBubbleColor || '#ffffff';
        aiBubbleColorInput.value = chat.settings.aiBubbleColor || '#ffffff';
        userFontColorInput.value = chat.settings.userFontColor || '#262626'; // 新增
        aiFontColorInput.value = chat.settings.aiFontColor || '#262626';   // 新增

        // 【修改】只要设置了气泡颜色或字体颜色，都算作“颜色已设置”
        bubbleStyleModal.dataset.isColorSet = (chat.settings.userBubbleColor || chat.settings.aiBubbleColor || chat.settings.userFontColor || chat.settings.aiFontColor) ? 'true' : 'false';

        customCssInput.value = chat.settings.customCss || '';
        updateBubblePreview();
        bubbleStyleModal.classList.add('visible');
    }

    // 更新气泡预览
    function updateBubblePreview() {
        const css = customCssInput.value;
        const isColorSet = bubbleStyleModal.dataset.isColorSet === 'true';

        // --- 步骤 1: 彻底重置所有样式 ---
        previewUserBubble.removeAttribute('style');
        previewAiBubble.removeAttribute('style');
        // 【新增】同时移除可能残留的class，确保干净的预览环境
        previewUserBubble.className = 'message-bubble user-bubble';
        previewAiBubble.className = 'message-bubble ai-bubble';

        // --- 步骤 2: 根据当前主题，应用基础样式 ---
        if (document.body.classList.contains('theme-pop')) {
            // 应用pop主题的基础样式
            previewAiBubble.style.backgroundColor = '#ffffff';
            previewAiBubble.style.color = '#2e2e2e';
            previewUserBubble.style.backgroundColor = '#fedae8';
            previewUserBubble.style.color = '#2e2e2e';
        } else if (document.body.classList.contains('theme-wechat')) {
            // 应用微信主题的基础样式
            previewAiBubble.style.backgroundColor = '#ffffff';
            previewAiBubble.style.color = '#333333';
            previewUserBubble.style.backgroundColor = '#a5f067';
            previewUserBubble.style.color = '#333333';
        } else {
            // 应用默认iMessage主题的基础样式
            previewAiBubble.style.backgroundColor = '#EBEBEB';
            previewAiBubble.style.color = '#262626';
            previewUserBubble.style.backgroundColor = '#007Aff';
            previewUserBubble.style.color = 'white';
        }

        // --- 步骤 3: 更新颜色选择器旁边的色块 (这部分不变) ---
        userBubbleColorInput.parentElement.style.setProperty('--color-preview', userBubbleColorInput.value);
        aiBubbleColorInput.parentElement.style.setProperty('--color-preview', aiBubbleColorInput.value);
        userFontColorInput.parentElement.style.setProperty('--color-preview', userFontColorInput.value);
        aiFontColorInput.parentElement.style.setProperty('--color-preview', aiFontColorInput.value);

        // --- 步骤 4: 更新预览区头像 (这部分不变) ---
        const chat = chats.find(c => c.id === activeChatId);
        const defaultAvatar = 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';
        if (chat) {
            document.getElementById('preview-ai-avatar').src = chat.settings.aiAvatar || defaultAvatar;
            document.getElementById('preview-user-avatar').src = chat.settings.userAvatar || defaultAvatar;
        }

        // --- 步骤 5: 按优先级应用自定义样式 ---
        // 最高优先级：自定义CSS
        if (css && css.trim() !== '') {
            // (这部分逻辑不变)
            if (css.includes('.user-bubble')) {
                try {
                    const bgMatch = css.match(/\.user-bubble\s*\{[^\}]*background:[^;\}]*/);
                    if (bgMatch) previewUserBubble.style.background = bgMatch[0].split(':')[1].trim();
                    const colorMatch = css.match(/\.user-bubble\s*\{[^\}]*color:[^;\}]*/);
                    if (colorMatch) previewUserBubble.style.color = colorMatch[0].split(':')[1].trim();
                } catch (e) { }
            }
            if (css.includes('.ai-bubble')) {
                try {
                    const bgMatch = css.match(/\.ai-bubble\s*\{[^\}]*background:[^;\}]*/);
                    if (bgMatch) previewAiBubble.style.background = bgMatch[0].split(':')[1].trim();
                    const colorMatch = css.match(/\.ai-bubble\s*\{[^\}]*color:[^;\}]*/);
                    if (colorMatch) previewAiBubble.style.color = colorMatch[0].split(':')[1].trim();
                } catch (e) { }
            }
        }
        // 第二优先级：自定义颜色
        else if (isColorSet) {
            previewUserBubble.style.background = userBubbleColorInput.value;
            previewUserBubble.style.color = userFontColorInput.value;
            previewAiBubble.style.background = aiBubbleColorInput.value;
            previewAiBubble.style.color = aiFontColorInput.value;
        }
        // 最低优先级：默认主题样式 (已在步骤2中应用)
    }

    // 打开背景设置弹窗
    function openBackgroundModal() {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        if (chat.settings.background) {
            backgroundPreview.style.backgroundImage = `url(${chat.settings.background})`;
            removeBackgroundBtn.style.display = 'block';
        } else {
            backgroundPreview.style.backgroundImage = 'none';
            removeBackgroundBtn.style.display = 'none';
        }
        backgroundModal.classList.add('visible');
    }

    // 处理背景图片上传
    function handleBackgroundUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            backgroundPreview.style.backgroundImage = `url(${imageUrl})`;
            removeBackgroundBtn.style.display = 'block';
        };
        reader.readAsDataURL(file);
        backgroundUploadInput.value = '';
    }



    // --- 功能函数 ---
    // ===================================================================
    // 【全新 V2.03】信息页面与表情包库核心功能
    // ===================================================================

    /**
     * 打开“对方信息”页面
     */
    function openAiInfoScreen() {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        // 【核心修复】检查并初始化表情包库，确保旧数据也能兼容
        if (!chat.settings.stickerPacks) {
            chat.settings.stickerPacks = [
                { id: 'default', name: '默认', isDefault: true, enabled: true, stickers: [] }
            ];
        }

        // 1. 填充基本信息
        aiInfoAvatar.src = chat.settings.aiAvatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';
        aiInfoNameDisplay.textContent = chat.settings.aiName || chat.name;
        aiPersonaInput.value = chat.settings.aiPersona || '';
        aiRelationshipInput.value = chat.settings.aiRelationship || '';

        // 2. 填充关联角色书
        populateAiInfoAssociations(chat.settings.aiAssociations || []);

        // 3. 渲染表情包库列表
        renderStickerPacks(chat);

        // 4. 显示屏幕
        showScreen('ai-info-screen');
    }

    /**
     * 打开“我的信息”页面
     */
    function openMyInfoScreen() {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        // 1. 填充信息
        myInfoAvatar.src = chat.settings.userAvatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp';
        myInfoNameDisplay.textContent = chat.settings.userName || '未设置';
        myPersonaInput.value = chat.settings.userPersona || '';
        mySupplementaryInfoInput.value = chat.settings.userSupplementaryInfo || '';

        // 2. 显示屏幕
        showScreen('my-info-screen');
    }

    /**
     * 保存“对方信息”
     */
    function saveAiInfo() {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        // 【新增】保存名字
        const newAiName = aiInfoNameDisplay.textContent.trim();
        chat.name = newAiName;
        chat.settings.aiName = newAiName;

        chat.settings.aiPersona = aiPersonaInput.value;
        chat.settings.aiRelationship = aiRelationshipInput.value;

        const selectedAssociations = Array.from(aiInfoAssociationsDropdown.querySelectorAll('.preset-dropdown-list input:checked')).map(input => input.dataset.id);
        chat.settings.aiAssociations = selectedAssociations;

        saveChats();
        renderContactList(); // 刷新联系人列表以显示新名字
        chatContactName.textContent = newAiName; // 刷新聊天顶栏的名字
        alert('对方信息已保存！');
        openChatSettings(); // 【核心新增】在显示前，重新加载聊天设置页的数据
        showScreen('chat-settings-screen');
    }
    /**
    * 保存“我的信息”
    */
    function saveMyInfo() {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        // 【核心修复】先获取旧名字，再保存新名字
        const oldUserName = chat.settings.userName || '我';
        const newUserName = myInfoNameDisplay.textContent.trim();

        chat.settings.userName = newUserName;
        chat.settings.userPersona = myPersonaInput.value;
        chat.settings.userSupplementaryInfo = mySupplementaryInfoInput.value;

        // 【核心新增】遍历所有动态和评论，更新旧名字
        if (coupleSpaceSettings.statuses && coupleSpaceSettings.statuses.length > 0) {
            coupleSpaceSettings.statuses.forEach(status => {
                // 更新动态发布者的名字
                if (status.name === oldUserName) {
                    status.name = newUserName || '我';
                }
                // 更新评论者的名字
                if (status.comments && status.comments.length > 0) {
                    status.comments.forEach(comment => {
                        if (comment.commenterName === oldUserName) {
                            comment.commenterName = newUserName || '我';
                        }
                    });
                }
            });
        }

        // 保存所有更改
        saveCoupleSpaceSettings();
        saveChats();

        alert('我的信息已保存！');
        openChatSettings();
        showScreen('chat-settings-screen');
        // 【新增】如果情侣空间已绑定，则刷新动态列表以显示新名字
        if (coupleSpaceSettings.partnerChatId) {
            renderStatusFeed();
        }
    }

    // 【全新 V2.03】我的信息页面事件

    // 【新增】为信息页面的头像和名字添加点击事件
    aiInfoAvatar.addEventListener('click', () => {
        currentAvatarUploadTarget = 'ai'; // 标记当前要上传的是AI头像
        avatarUploadInput.click();
    });
    myInfoAvatar.addEventListener('click', () => {
        currentAvatarUploadTarget = 'user'; // 标记当前要上传的是用户头像
        avatarUploadInput.click();
    });

    aiInfoNameDisplay.addEventListener('click', () => {
        aiInfoNameDisplay.contentEditable = true;
        aiInfoNameDisplay.focus();
    });
    myInfoNameDisplay.addEventListener('click', () => {
        myInfoNameDisplay.contentEditable = true;
        myInfoNameDisplay.focus();
    });

    /**
     * 填充对方信息页的关联角色书下拉列表
     */
    /**
     * 【【【逻辑分离】】】为对方信息页填充关联项 (只能关联角色)
     */
    function populateAiInfoAssociations(selectedIds = []) {
        const dropdownList = aiInfoAssociationsDropdown.querySelector('.preset-dropdown-list');
        dropdownList.innerHTML = '';

        // 筛选出非禁词的角色书
        const availableRoles = presets.roles.filter(role => role.id !== 'forbidden_words');

        if (availableRoles.length === 0) {
            dropdownList.innerHTML = `<div class="preset-dropdown-item" style="padding: 16px 12px;">暂无角色书可关联</div>`;
        } else {
            availableRoles.forEach(item => {
                const isChecked = selectedIds.includes(item.id);
                const li = document.createElement('div');
                li.className = 'preset-dropdown-item';
                const checkboxId = `ai_assoc_${item.id}`;
                li.innerHTML = `
                            <input type="checkbox" id="${checkboxId}" data-id="${item.id}" ${isChecked ? 'checked' : ''}>
                            <label for="${checkboxId}">${item.name}</label>
                        `;
                dropdownList.appendChild(li);
            });
        }
        updateAiInfoDropdownLabel(selectedIds.length);
    }

    /**
     * 更新对方信息页的下拉框标签文本
     */
    function updateAiInfoDropdownLabel(count) {
        if (count > 0) {
            aiInfoDropdownLabel.textContent = `已选择 ${count} 项`;
        } else {
            aiInfoDropdownLabel.textContent = '点击选择';
        }
    }

    /**
     * 渲染表情包库列表
     */
    function renderStickerPacks(chat) {
        aiInfoStickerPackList.innerHTML = ''; // 清空

        // 1. 渲染默认包和添加按钮在同一行
        const defaultRow = document.createElement('div');
        defaultRow.className = 'sticker-pack-item';
        const defaultPack = chat.settings.stickerPacks.find(p => p.isDefault);
        if (defaultPack) {
            defaultRow.innerHTML = `
                        <div class="sticker-pack-name-wrapper">
                            <span class="sticker-pack-name default-pack" data-pack-id="${defaultPack.id}">${defaultPack.name}</span>
                        </div>
                        <div class="sticker-pack-actions">
                            <button class="add-sticker-pack-btn" id="add-sticker-pack-btn">
                                <svg t="1757638742634" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="28011" width="27" height="27"><path d="M828.704099 196.575729C744.096116 112.384034 631.648434 66.016073 512 66.016073s-232.1288 46.367961-316.736783 130.559656C110.624271 280.800108 64 392.831501 64 512c0 119.199462 46.624271 231.199892 131.232254 315.424271 84.607983 84.191695 197.088348 130.559656 316.736783 130.559656s232.1288-46.367961 316.704099-130.559656c84.67163-84.255342 131.295901-196.288456 131.263217-315.455235C959.967316 392.800538 913.375729 280.800108 828.704099 196.575729zM736.00086 544.00086 544.00086 544.00086l0 192c0 17.695686-14.336138 32.00086-32.00086 32.00086s-32.00086-14.303454-32.00086-32.00086L479.99914 544.00086 288.00086 544.00086c-17.664722 0-32.00086-14.336138-32.00086-32.00086s14.336138-32.00086 32.00086-32.00086l192 0L480.00086 288.00086c0-17.664722 14.336138-32.00086 32.00086-32.00086s32.00086 14.336138 32.00086 32.00086l0 192 192 0c17.695686 0 32.00086 14.336138 32.00086 32.00086S753.696546 544.00086 736.00086 544.00086z" fill="#353333" p-id="28012"></path></svg>
                            </button>
                        </div>
                    `;
        }
        aiInfoStickerPackList.appendChild(defaultRow);

        // 2. 渲染其他自定义的表情包
        chat.settings.stickerPacks.forEach(pack => {
            if (pack.isDefault) return;

            const item = document.createElement('div');
            item.className = 'sticker-pack-item';

            const isChecked = pack.enabled ? 'checked' : '';
            const checkedSvg = isChecked ? `<svg t="1757638693998" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="26732" width="14" height="14"><path d="M384 768c-12.8 0-21.333333-4.266667-29.866667-12.8l-213.333333-213.333333c-17.066667-17.066667-17.066667-42.666667 0-59.733334s42.666667-17.066667 59.733333 0L384 665.6 823.466667 226.133333c17.066667-17.066667 42.666667-17.066667 59.733333 0s17.066667 42.666667 0 59.733334l-469.333333 469.333333c-8.533333 8.533333-17.066667 12.8-29.866667 12.8z" p-id="26733" fill="#ffffff"></path></svg>` : '';

            item.innerHTML = `
                        <div class="sticker-pack-name-wrapper">
                            <span class="sticker-pack-name" data-pack-id="${pack.id}">${pack.name === '默认' ? '' : pack.name}</span>
                        </div>
                        <div class="sticker-pack-actions">
                             <button class="delete-sticker-pack-btn" data-pack-id="${pack.id}">
                                <svg t="1757458251149" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="16" height="16" style="transform: rotate(45deg);"><path d="M902.343 570.936h-331.78v331.833c0 32.337-26.226 58.537-58.564 58.537-32.337 0-58.563-26.2-58.563-58.537V570.936H121.654c-32.364 0-58.564-26.2-58.564-58.538 0-32.325 26.203-58.537 58.564-58.537h331.78V122.028c0-32.325 26.226-58.537 58.563-58.537 32.338 0 58.564 26.213 58.564 58.537v331.834h331.78c32.364 0 58.565 26.211 58.565 58.535-0.001 32.337-26.2 58.536-58.565 58.536z" fill="#aaa"></path></svg>
                            </button>
                            <div class="sticker-pack-checkbox-wrapper ${isChecked}" data-pack-id="${pack.id}">
                                ${checkedSvg}
                            </div>
                        </div>
                    `;
            aiInfoStickerPackList.appendChild(item);
        });
    }

    /**
     * 打开表情管理页面
     */
    function openManageStickersScreen(packId) {
        const chat = chats.find(c => c.id === activeChatId);
        const pack = chat?.settings.stickerPacks.find(p => p.id === packId);
        if (!pack) return;

        currentManagingStickerPack = { chatId: activeChatId, packId: packId };

        stickerPackTitleEditor.textContent = pack.name;
        stickerPackTitleEditor.contentEditable = !pack.isDefault;

        // 【核心修复】调用我们新注入的渲染函数
        renderStickerManagementGrid(pack.stickers || []);

        manageStickersScreen.classList.remove('delete-mode');
        stickerDeleteModeBtn.style.display = 'block';
        deleteModeActions.style.display = 'none';

        showScreen('manage-stickers-screen');
    }

    /**
     * 渲染管理页面的表情网格
     */
    function renderStickerManagementGrid(stickersInPack) {
        stickerManagementGridView.innerHTML = ''; // 清空

        // “添加”按钮
        const addBtnWrapper = document.createElement('div');
        addBtnWrapper.className = 'add-sticker-btn-wrapper manage-sticker-item-wrapper';
        addBtnWrapper.innerHTML = `<svg t="1757458251149" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M902.343 570.936h-331.78v331.833c0 32.337-26.226 58.537-58.564 58.537-32.337 0-58.563-26.2-58.563-58.537V570.936H121.654c-32.364 0-58.564-26.2-58.564-58.538 0-32.325 26.203-58.537 58.564-58.537h331.78V122.028c0-32.325 26.226-58.537 58.563-58.537 32.338 0 58.564 26.213 58.564 58.537v331.834h331.78c32.364 0 58.565 26.211 58.565 58.535-0.001 32.337-26.2 58.536-58.565 58.536z" fill="#353333"></path></svg>`;
        stickerManagementGridView.appendChild(addBtnWrapper);

        // 渲染表情
        stickersInPack.forEach(sticker => {
            const stickerWrapper = document.createElement('div');
            stickerWrapper.className = 'manage-sticker-item-wrapper';
            stickerWrapper.innerHTML = `
                        <div class="sticker-item" data-sticker-id="${sticker.id}">
                            <img src="${sticker.url}" alt="${sticker.name}">
                        </div>
                        <div class="sticker-delete-checkbox" data-sticker-id="${sticker.id}"></div>
                    `;
            stickerManagementGridView.appendChild(stickerWrapper);
        });
    }

    /**
     * 在管理页面添加新表情
     */
    function addStickerToCurrentPack(name, url) {
        const { chatId, packId } = currentManagingStickerPack;
        const chat = chats.find(c => c.id === chatId);
        const pack = chat?.settings.stickerPacks.find(p => p.id === packId);

        if (pack) {
            const newSticker = {
                id: 'sticker_' + Date.now() + Math.random(), // 【核心修复】确保ID绝对唯一
                name: name,
                url: url
            };
            pack.stickers.push(newSticker);
            saveChats();
            renderStickerManagementGrid(pack.stickers); // 刷新当前页面
        }
    }





    // --- 事件监听 ---

    // ===================================================================
    // 【V2.30】消息交互事件监听
    // ===================================================================

    // 交互菜单按钮的事件委托
    messageContextMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.context-menu-item');
        if (item && !item.classList.contains('placeholder')) {
            const action = item.dataset.action;
            switch (action) {
                case 'reply': handleReply(); break;
                case 'edit': handleEdit(); break;
                case 'copy': handleCopy(); break;
                case 'delete': handleDelete(); break;
                case 'insert': openInsertModal(); break; // 【【【新增】】】
                case 'multi-select': enterMultiSelectMode(); break; // 【【【新增】】】
            }
            messageContextMenu.classList.remove('visible');
        }
    });

    // 点击外部或滚动时关闭菜单
    chatInterfaceScreen.addEventListener('click', (e) => {
        // 【【【核心修复】】】 将所有特殊消息类型都加入到 "安全区" 选择器中
        if (!messageContextMenu.contains(e.target) && !e.target.closest('.message-bubble, .sticker-in-chat, .couple-status-card, .message-bubble-transfer, .photo-bubble, .real-photo-bubble, .message-bubble-voice')) {
            messageContextMenu.classList.remove('visible');
        }
    });
    messageContainer.addEventListener('scroll', () => {
        if (messageContextMenu.classList.contains('visible')) {
            messageContextMenu.classList.remove('visible');
        }
    });

    // 取消引用
    cancelReplyBtn.addEventListener('click', () => {
        replyInfo = null;
        replyBar.style.display = 'none';
    });

    // ===================================================================
    // 【全新 V1.91】外观设置页面事件监听
    // ===================================================================
    // 在主设置页面，点击“外观设置”
    const mainSettingsContainer = document.getElementById('main-settings-container');
    if (mainSettingsContainer) {
        const appearanceSettingsBtn = mainSettingsContainer.querySelector('.settings-item:nth-of-type(4)'); // 第四个是外观设置
        if (appearanceSettingsBtn) {
            appearanceSettingsBtn.addEventListener('click', () => showScreen('appearance-settings-screen'));
        }
    }

    // 在外观设置页面，点击“更换应用图标”
    gotoAppIconSettingsBtn.addEventListener('click', () => {
        renderAppIconSettingsPage(); // 渲染页面
        showScreen('app-icon-settings-screen');
    });

    // 在外观设置页面，点击“更换桌面壁纸”
    openDesktopWallpaperModalBtn.addEventListener('click', () => {
        // 打开时，根据当前壁纸状态更新预览
        if (desktopWallpaper) {
            desktopWallpaperPreview.style.backgroundImage = `url(${desktopWallpaper})`;
            removeDesktopWallpaperBtn.style.display = 'block';
        } else {
            desktopWallpaperPreview.style.backgroundImage = 'none';
            removeDesktopWallpaperBtn.style.display = 'none';
        }
        desktopWallpaperModal.classList.add('visible');
    });

    // 更换桌面壁纸弹窗内的交互
    desktopWallpaperPreview.addEventListener('click', () => desktopWallpaperUploadInput.click());
    desktopWallpaperUploadInput.addEventListener('change', handleDesktopWallpaperUpload);
    removeDesktopWallpaperBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        desktopWallpaperPreview.style.backgroundImage = 'none';
        removeDesktopWallpaperBtn.style.display = 'none';
    });
    saveDesktopWallpaperBtn.addEventListener('click', () => {
        const bgStyle = desktopWallpaperPreview.style.backgroundImage;
        desktopWallpaper = bgStyle.startsWith('url') ? bgStyle.slice(5, -2) : '';
        saveDesktopSettings();
        applyDesktopSettings(); // 立即应用
        desktopWallpaperModal.classList.remove('visible');
    });

    // “更换应用图标”页面的事件委托
    appIconSettingsContainer.addEventListener('click', (e) => {
        const target = e.target;
        const iconKey = target.dataset.iconKey;
        if (!iconKey) return;

        // 点击上传按钮
        if (target.classList.contains('app-icon-upload-btn')) {
            currentImageUploadTarget = `icon-${iconKey}`; // 设置上传目标
            desktopFileInput.click(); // 触发全局文件选择器
        }

        // 点击重置按钮
        if (target.classList.contains('app-icon-reset-btn')) {
            if (desktopIconSettings[iconKey]) {
                delete desktopIconSettings[iconKey].imageUrl;
                delete desktopIconSettings[iconKey].url;
            }
            // 清空输入框
            const input = appIconSettingsContainer.querySelector(`.app-icon-url-input[data-icon-key="${iconKey}"]`);
            if (input) input.value = '';

            saveDesktopSettings();
            applyDesktopIconSettings(); // 立即更新
        }
    });

    // 为URL输入框添加事件委托
    appIconSettingsContainer.addEventListener('input', (e) => {
        const target = e.target;
        if (target.classList.contains('app-icon-url-input')) {
            const iconKey = target.dataset.iconKey;
            if (!desktopIconSettings[iconKey]) {
                desktopIconSettings[iconKey] = {};
            }
            desktopIconSettings[iconKey].url = target.value.trim();
            saveDesktopSettings();
            applyDesktopIconSettings(); // 实时更新
        }
    });

    // ===================================================================
    // 【新增】素材页面核心功能函数
    // ===================================================================

    /**
     * 渲染“素材”页面的所有内容
     */
    function renderAssetsPage() {
        renderWritingStyles();
        renderSocialAssets();
    }

    /**
     * 渲染“文风”板块
     */
    function renderWritingStyles() {
        const listContainer = document.getElementById('writing-style-list');
        const arrowBtn = document.querySelector('#writing-style-section .asset-section-arrow');
        listContainer.innerHTML = '';

        const styles = presets.assets.writingStyles || [];

        arrowBtn.style.display = styles.length > 0 ? 'block' : 'none';

        styles.forEach(style => {
            const item = document.createElement('div');
            item.className = 'asset-list-item';
            item.innerHTML = `
                        <span class="drag-handle">☰</span>
                        <span class="asset-list-name">${style.name}</span>
                        <div class="asset-list-actions">
                             <button data-action="delete" data-type="writingStyle" data-id="${style.id}">
                                <svg t="1758256966353" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="57284" width="18" height="18"><path d="M801.856 734.016 579.904 512l222.016-222.016c18.816-18.816 18.88-49.152 0.064-67.968-18.752-18.752-49.216-18.752-67.904 0L512 444.032 289.92 222.016c-18.688-18.752-49.088-18.752-67.904 0C203.328 240.768 203.328 271.232 222.144 290.048L444.096 512l-222.016 221.952c-18.816 18.752-18.816 49.152-0.064 67.968C231.424 811.392 243.84 816 256 816s24.576-4.608 33.92-14.016L512 579.968l222.08 222.016c9.408 9.344 21.696 14.016 33.92 14.016 12.288 0 24.576-4.608 33.92-14.016C820.672 783.104 820.736 752.768 801.856 734.016z" p-id="57285" fill="#302f2f"></path></svg>
                            </button>
                            <button data-action="edit" data-type="writingStyle" data-id="${style.id}">
                                <svg t="1758256914811" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="55901" width="18" height="18"><path d="M550.4 292.48l180.992 180.992-422.4 422.4H128v-181.034667l422.4-422.4z m60.330667-60.373333l90.496-90.496a42.666667 42.666667 0 0 1 60.330666 0l120.704 120.661333a42.666667 42.666667 0 0 1 0 60.373333l-90.538666 90.496-180.992-181.034666z" fill="#302f2f" p-id="55902"></path></svg>
                            </button>
                        </div>
                    `;
            listContainer.appendChild(item);
        });
    }

    /**
     * 渲染“朋友圈素材”板块
     */
    function renderSocialAssets() {
        const listContainer = document.getElementById('social-asset-list');
        const arrowBtn = document.querySelector('#social-asset-section .asset-section-arrow');
        listContainer.innerHTML = '';

        const assets = presets.assets.socialAssets || [];

        arrowBtn.style.display = assets.length > 0 ? 'block' : 'none';

        assets.forEach(asset => {
            const item = document.createElement('div');
            item.className = 'asset-list-item';
            item.innerHTML = `
                        <span class="drag-handle">☰</span>
                        <span class="asset-list-name">${asset.name}</span>
                        <div class="asset-list-actions">
                             <button data-action="delete" data-type="socialAsset" data-id="${asset.id}">
                                <svg t="1758256966353" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="57284" width="18" height="18"><path d="M801.856 734.016 579.904 512l222.016-222.016c18.816-18.816 18.88-49.152 0.064-67.968-18.752-18.752-49.216-18.752-67.904 0L512 444.032 289.92 222.016c-18.688-18.752-49.088-18.752-67.904 0C203.328 240.768 203.328 271.232 222.144 290.048L444.096 512l-222.016 221.952c-18.816 18.752-18.816 49.152-0.064 67.968C231.424 811.392 243.84 816 256 816s24.576-4.608 33.92-14.016L512 579.968l222.08 222.016c9.408 9.344 21.696 14.016 33.92 14.016 12.288 0 24.576-4.608 33.92-14.016C820.672 783.104 820.736 752.768 801.856 734.016z" p-id="57285" fill="#302f2f"></path></svg>
                            </button>
                            <button data-action="edit" data-type="socialAsset" data-id="${asset.id}">
                                <svg t="1758256914811" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="55901" width="18" height="18"><path d="M550.4 292.48l180.992 180.992-422.4 422.4H128v-181.034667l422.4-422.4z m60.330667-60.373333l90.496-90.496a42.666667 42.666667 0 0 1 60.330666 0l120.704 120.661333a42.666667 42.666667 0 0 1 0 60.373333l-90.538666 90.496-180.992-181.034666z" fill="#302f2f" p-id="55902"></path></svg>
                            </button>
                        </div>
                    `;
            listContainer.appendChild(item);
        });
    }

    /**
     * 打开素材编辑器（文风或朋友圈素材）
     */
    function openAssetEditor(type, id) {
        currentEditingAsset = { type, id };
        if (type === 'writingStyle') {
            const title = document.getElementById('writing-style-editor-title');
            const nameInput = document.getElementById('new-writing-style-name-input');
            const influenceInput = document.getElementById('new-writing-style-influence-input');
            const contentInput = document.getElementById('new-writing-style-content-input');

            if (id) { // 编辑模式
                const style = presets.assets.writingStyles.find(s => s.id === id);
                title.textContent = '编辑文风';
                nameInput.value = style.name;
                influenceInput.value = style.influence;
                contentInput.value = style.content;
            } else { // 创建模式
                title.textContent = '创建文风';
                nameInput.value = '';
                influenceInput.value = '50';
                contentInput.value = '';
            }
            showScreen('preset-writing-style-edit-screen');
        } else if (type === 'socialAsset') {
            const title = document.getElementById('social-asset-editor-title');
            const nameInput = document.getElementById('new-social-asset-name-input');
            const influenceInput = document.getElementById('new-social-asset-influence-input');
            const contentInput = document.getElementById('new-social-asset-content-input');

            if (id) { // 编辑模式
                const asset = presets.assets.socialAssets.find(a => a.id === id);
                title.textContent = '编辑素材';
                nameInput.value = asset.name;
                influenceInput.value = asset.influence;
                contentInput.value = asset.content;
                currentEditingSocialAssetImages = [...(asset.images || [])];
            } else { // 创建模式
                title.textContent = '创建素材';
                nameInput.value = '';
                influenceInput.value = '50';
                contentInput.value = '';
                currentEditingSocialAssetImages = [];
            }
            renderSocialAssetImageList();
            showScreen('preset-social-asset-edit-screen');
        }
    }

    /**
     * 在朋友圈素材编辑器中，渲染图片列表
     */
    /**
     * 在朋友圈素材编辑器中，渲染图片列表
     */
    function renderSocialAssetImageList() {
        const listContainer = document.getElementById('social-asset-image-list');
        listContainer.innerHTML = '';
        currentEditingSocialAssetImages.forEach(image => {
            const item = document.createElement('div');
            item.className = 'asset-image-item';
            item.dataset.id = image.id;

            const isChecked = image.active ? 'checked' : '';
            const checkedSvg = isChecked ? '<svg t="1757638693998" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="26732" width="14" height="14"><path d="M384 768c-12.8 0-21.333333-4.266667-29.866667-12.8l-213.333333-213.333333c-17.066667-17.066667-17.066667-42.666667 0-59.733334s42.666667-17.066667 59.733333 0L384 665.6 823.466667 226.133333c17.066667-17.066667 42.666667-17.066667 59.733333 0s17.066667 42.666667 0 59.733334l-469.333333 469.333333c-8.533333 8.533333-17.066667 12.8-29.866667 12.8z" p-id="26733" fill="#ffffff"></path></svg>' : '';

            item.innerHTML = `
                        <span class="item-name" contenteditable="true" maxlength="4">${image.name || ''}</span>
                        <div class="item-url">${image.url}</div>
                        <div class="item-actions">
                            <button data-action="delete-image">
                               <svg t="1758256966353" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="57284" width="18" height="18"><path d="M801.856 734.016 579.904 512l222.016-222.016c18.816-18.816 18.88-49.152 0.064-67.968-18.752-18.752-49.216-18.752-67.904 0L512 444.032 289.92 222.016c-18.688-18.752-49.088-18.752-67.904 0C203.328 240.768 203.328 271.232 222.144 290.048L444.096 512l-222.016 221.952c-18.816 18.752-18.816 49.152-0.064 67.968C231.424 811.392 243.84 816 256 816s24.576-4.608 33.92-14.016L512 579.968l222.08 222.016c9.408 9.344 21.696 14.016 33.92 14.016 12.288 0 24.576-4.608 33.92-14.016C820.672 783.104 820.736 752.768 801.856 734.016z" p-id="57285" fill="#302f2f"></path></svg>
                            </button>
                             <div class="font-entry-checkbox ${isChecked}">
                                ${checkedSvg}
                            </div>
                        </div>
                    `;
            listContainer.appendChild(item);
        });
    }

    // ===================================================================
    // 【全新 V2.21】世界书功能核心函数 (重构版)
    // ===================================================================

    // --- 数据持久化 ---
    async function savePresets() {
        try {
            await db.set('presets', presets);
        } catch (error) {
            console.error("保存世界书失败:", error);
        }
    }

    async function loadPresets() {
        const savedPresets = await db.get('presets');
        if (savedPresets) {
            presets = {
                roles: savedPresets.roles || [],
                forbiddenWords: savedPresets.forbiddenWords || { position: 'all', content: '', avatar: '' },
                offlines: savedPresets.offlines || [],
                // 【核心修改】确保 assets 对象及其子数组存在
                assets: savedPresets.assets || { writingStyles: [], socialAssets: [] }
            };
            // 再次检查，防止旧数据没有子数组
            if (!presets.assets.writingStyles) presets.assets.writingStyles = [];
            if (!presets.assets.socialAssets) presets.assets.socialAssets = [];
        }
        // 初始化时渲染所有页面
        renderRolePresetsPage();
        renderOfflinePresetsPage();
        renderAssetsPage();
    }

    // --- 页面渲染 ---
    function renderRolePresetsPage() {
        presetPageRole.innerHTML = ''; // 清空

        // 渲染固定的“禁词”项... (这部分代码不变，省略)
        const forbiddenWordsItem = document.createElement('div');
        forbiddenWordsItem.className = 'preset-list-item forbidden-words-item';
        forbiddenWordsItem.innerHTML = `
                    <img src="${presets.forbiddenWords.avatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp'}" class="preset-list-avatar" data-type="forbidden-words" data-id="forbidden_words">
                    <span class="preset-list-name">禁词</span>
                    <div class="preset-list-actions">
                        <button data-action="edit-forbidden-words">
                           <svg t="1758256914811" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="55901" width="18" height="18"><path d="M550.4 292.48l180.992 180.992-422.4 422.4H128v-181.034667l422.4-422.4z m60.330667-60.373333l90.496-90.496a42.666667 42.666667 0 0 1 60.330666 0l120.704 120.661333a42.666667 42.666667 0 0 1 0 60.373333l-90.538666 90.496-180.992-181.034666z" fill="#302f2f" p-id="55902"></path></svg>
                        </button>
                    </div>
                `;
        presetPageRole.appendChild(forbiddenWordsItem);

        // 渲染用户自定义的角色... (这部分代码不变，省略)
        presets.roles.forEach(preset => {
            const item = document.createElement('div');
            item.className = 'preset-list-item';
            item.dataset.id = preset.id;
            item.innerHTML = `
                        <img src="${preset.avatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp'}" class="preset-list-avatar" data-type="role" data-id="${preset.id}">
                        <span class="preset-list-name">${preset.name}</span>
                        <div class="preset-list-actions">
                            <button data-action="delete-role" data-id="${preset.id}">
                               <svg t="1758256966353" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="57284" width="18" height="18"><path d="M801.856 734.016 579.904 512l222.016-222.016c18.816-18.816 18.88-49.152 0.064-67.968-18.752-18.752-49.216-18.752-67.904 0L512 444.032 289.92 222.016c-18.688-18.752-49.088-18.752-67.904 0C203.328 240.768 203.328 271.232 222.144 290.048L444.096 512l-222.016 221.952c-18.816 18.752-18.816 49.152-0.064 67.968C231.424 811.392 243.84 816 256 816s24.576-4.608 33.92-14.016L512 579.968l222.08 222.016c9.408 9.344 21.696 14.016 33.92 14.016 12.288 0 24.576-4.608 33.92-14.016C820.672 783.104 820.736 752.768 801.856 734.016z" p-id="57285" fill="#302f2f"></path></svg>
                            </button>
                            <button data-action="edit-role" data-id="${preset.id}">
                               <svg t="1758256914811" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="55901" width="18" height="18"><path d="M550.4 292.48l180.992 180.992-422.4 422.4H128v-181.034667l422.4-422.4z m60.330667-60.373333l90.496-90.496a42.666667 42.666667 0 0 1 60.330666 0l120.704 120.661333a42.666667 42.666667 0 0 1 0 60.373333l-90.538666 90.496-180.992-181.034666z" fill="#302f2f" p-id="55902"></path></svg>
                            </button>
                        </div>
                    `;
            presetPageRole.appendChild(item);
        });
    }

    /**
     * 【【【核心新增】】】渲染“预设”页面列表
     */
    function renderOfflinePresetsPage() {
        const presetPageOffline = document.getElementById('preset-page-offline');
        presetPageOffline.innerHTML = ''; // 清空

        if (presets.offlines.length === 0) {
            presetPageOffline.innerHTML = `<p style="text-align:center; color:#888; margin-top: 40px;">还没有预设，点击右上角“+”创建一个吧</p >`;
            return;
        }

        presets.offlines.forEach(preset => {
            const item = document.createElement('div');
            item.className = 'preset-list-item-offline';
            item.dataset.id = preset.id;
            // 【核心修改】调整了操作按钮的顺序和开关的样式
            item.innerHTML = `
                        <span class="drag-handle">☰</span>
                        <span class="preset-list-name">${preset.name}</span>
                        <div class="preset-list-actions">
                             <button data-action="delete-offline-preset" data-id="${preset.id}">
                                <svg t="1758256966353" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="57284" width="18" height="18"><path d="M801.856 734.016 579.904 512l222.016-222.016c18.816-18.816 18.88-49.152 0.064-67.968-18.752-18.752-49.216-18.752-67.904 0L512 444.032 289.92 222.016c-18.688-18.752-49.088-18.752-67.904 0C203.328 240.768 203.328 271.232 222.144 290.048L444.096 512l-222.016 221.952c-18.816 18.752-18.816 49.152-0.064 67.968C231.424 811.392 243.84 816 256 816s24.576-4.608 33.92-14.016L512 579.968l222.08 222.016c9.408 9.344 21.696 14.016 33.92 14.016 12.288 0 24.576-4.608 33.92-14.016C820.672 783.104 820.736 752.768 801.856 734.016z" p-id="57285" fill="#302f2f"></path></svg>
                            </button>
                            <button data-action="edit-offline-preset" data-id="${preset.id}">
                                <svg t="1758256914811" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="55901" width="18" height="18"><path d="M550.4 292.48l180.992 180.992-422.4 422.4H128v-181.034667l422.4-422.4z m60.330667-60.373333l90.496-90.496a42.666667 42.666667 0 0 1 60.330666 0l120.704 120.661333a42.666667 42.666667 0 0 1 0 60.373333l-90.538666 90.496-180.992-181.034666z" fill="#302f2f" p-id="55902"></path></svg>
                            </button>
                            <label class="switch" style="transform: scale(0.8);">
                                <input type="checkbox" data-action="toggle-offline-preset" data-id="${preset.id}" ${preset.enabled ? 'checked' : ''}>
                                <span class="slider round"></span>
                            </label>
                        </div>
                    `;
            presetPageOffline.appendChild(item);
        });
    }

    /**
     * 渲染“素材”页面的所有内容
     */
    function renderAssetsPage() {
        renderWritingStyles();
        renderSocialAssets();
    }


    // --- 编辑器内的交互 ---
    document.getElementById('preset-page-assets').addEventListener('click', e => {
        const target = e.target;
        const header = target.closest('.asset-section-header');
        const actionBtn = target.closest('.asset-list-actions button, .asset-section-add-btn');

        // 点击了展开/收起箭头
        if (target.closest('.asset-section-arrow')) {
            const section = target.closest('.asset-section');
            const list = section.querySelector('.asset-list-container');
            target.closest('.asset-section-arrow').classList.toggle('expanded');
            list.classList.toggle('expanded');
            return;
        }

        // 点击了“+”、编辑或删除按钮
        if (actionBtn) {
            const type = actionBtn.dataset.type;
            const id = actionBtn.dataset.id;
            const action = actionBtn.dataset.action || 'add';

            if (action === 'add') {
                openAssetEditor(type, null);
            } else if (action === 'edit') {
                openAssetEditor(type, id);
            } else if (action === 'delete') {
                const confirmText = type === 'writingStyle' ? '确定要删除该文风吗？' : '确定要删除该素材吗？';
                showConfirmationModal(confirmText, () => {
                    if (type === 'writingStyle') {
                        presets.assets.writingStyles = presets.assets.writingStyles.filter(s => s.id !== id);
                    } else {
                        presets.assets.socialAssets = presets.assets.socialAssets.filter(a => a.id !== id);
                    }
                    savePresets();
                    renderAssetsPage();
                });
            }
        }
    });

    // 文风编辑器保存
    document.getElementById('save-writing-style-btn').addEventListener('click', () => {
        const name = document.getElementById('new-writing-style-name-input').value.trim();
        if (!name) { alert('名称不能为空！'); return; }

        const styleData = {
            name,
            influence: document.getElementById('new-writing-style-influence-input').value,
            content: document.getElementById('new-writing-style-content-input').value,
        };

        if (currentEditingAsset.id) { // 编辑
            const index = presets.assets.writingStyles.findIndex(s => s.id === currentEditingAsset.id);
            presets.assets.writingStyles[index] = { ...presets.assets.writingStyles[index], ...styleData };
        } else { // 创建
            presets.assets.writingStyles.push({ id: 'ws_' + Date.now(), ...styleData });
        }
        savePresets();
        renderWritingStyles();
        showScreen('world-book-screen');
    });

    // 朋友圈素材编辑器保存
    document.getElementById('save-social-asset-btn').addEventListener('click', () => {
        const name = document.getElementById('new-social-asset-name-input').value.trim();
        if (!name) { alert('名称不能为空！'); return; }

        const assetData = {
            name,
            influence: document.getElementById('new-social-asset-influence-input').value,
            content: document.getElementById('new-social-asset-content-input').value,
            images: currentEditingSocialAssetImages, // 保存临时存储的图片列表
        };

        if (currentEditingAsset.id) { // 编辑
            const index = presets.assets.socialAssets.findIndex(a => a.id === currentEditingAsset.id);
            presets.assets.socialAssets[index] = { ...presets.assets.socialAssets[index], ...assetData };
        } else { // 创建
            presets.assets.socialAssets.push({ id: 'sa_' + Date.now(), ...assetData });
        }
        savePresets();
        renderSocialAssets();
        showScreen('world-book-screen');
    });

    // 朋友圈素材编辑器内的图片链接操作
    document.getElementById('add-social-asset-image-btn').addEventListener('click', () => {
        const urlInput = document.getElementById('new-social-asset-image-url-input');
        const keywordInput = document.getElementById('new-social-asset-keyword-input');
        const url = urlInput.value.trim();
        const keyword = keywordInput.value.trim();

        if (!url || !keyword) {
            alert('图片链接和关键词都不能为空！');
            return;
        }

        currentEditingSocialAssetImages.push({
            id: 'img_' + Date.now(),
            name: '',
            keyword,
            url,
            active: true,
        });

        urlInput.value = '';
        keywordInput.value = '';
        renderSocialAssetImageList();
    });

    document.getElementById('social-asset-image-list').addEventListener('click', e => {
        const item = e.target.closest('.asset-image-item');
        if (!item) return;
        const imageId = item.dataset.id;

        if (e.target.closest('[data-action="delete-image"]')) {
            currentEditingSocialAssetImages = currentEditingSocialAssetImages.filter(img => img.id !== imageId);
            renderSocialAssetImageList();
        } else if (e.target.closest('.font-entry-checkbox')) {
            const image = currentEditingSocialAssetImages.find(img => img.id === imageId);
            image.active = !image.active;
            renderSocialAssetImageList();
        }
    });

    document.getElementById('social-asset-image-list').addEventListener('blur', e => {
        const item = e.target.closest('.asset-image-item');
        if (!item) return;
        const imageId = item.dataset.id;
        const image = currentEditingSocialAssetImages.find(img => img.id === imageId);

        if (e.target.classList.contains('item-name') && image) {
            image.name = e.target.textContent.trim().slice(0, 4);
        }
    }, true);


    // --- 编辑器开启与填充 ---

    /**
     * 【【【逻辑分离】】】打开角色编辑器
     */
    function openRolePresetEditor(presetId) {
        currentEditingPresetId = presetId;
        // 重置所有输入字段
        presetNameText.textContent = '';
        const contentTextarea = document.getElementById('preset-content-text');
        contentTextarea.value = '';
        presetDropdownList.innerHTML = '';
        updateDropdownLabel(0);
        presetDropdownContainer.classList.remove('expanded');

        if (presetId) { // 编辑模式
            const preset = presets.roles.find(p => p.id === presetId);
            if (preset) {
                presetEditorTitle.textContent = '编辑角色';
                presetNameText.textContent = preset.name;
                contentTextarea.value = preset.content;
                populateRoleAssociations(preset.associations || []);
            }
        } else { // 创建模式
            presetEditorTitle.textContent = '创建角色';
            populateRoleAssociations([]); // 传入空数组以正确渲染
        }
        showScreen('preset-edit-screen');
    }

    /**
     * 【【【核心新增】】】打开预设编辑器
     */
    function openOfflinePresetEditor(presetId) {
        currentEditingOfflinePresetId = presetId;
        const title = document.getElementById('preset-offline-editor-title');
        const nameText = document.getElementById('preset-offline-name-text');
        // 【核心修改】这里获取的是 textarea 元素
        const contentTextarea = document.getElementById('preset-offline-content-text');
        const modeSelect = document.getElementById('preset-offline-mode-select');
        const roleSelect = document.getElementById('preset-offline-role-select');
        const positionSelect = document.getElementById('preset-offline-position-select');

        if (presetId) { // 编辑预设
            const preset = presets.offlines.find(p => p.id === presetId);
            if (preset) {
                title.textContent = '编辑预设';
                nameText.textContent = preset.name;
                // 【核心修改】为 textarea 设置 value
                contentTextarea.value = preset.prompt;
                modeSelect.value = preset.mode || 'all';
                roleSelect.value = preset.role || 'system';
                positionSelect.value = preset.position || 'before';
            }
        } else { // 创建预设
            title.textContent = '创建预设';
            nameText.textContent = '';
            // 【核心修改】清空 textarea 的 value
            contentTextarea.value = ''
            modeSelect.value = 'all';
            roleSelect.value = 'system';
            positionSelect.value = 'before';
        }
        showScreen('preset-offline-edit-screen');
    }


    /**
     * 【【【逻辑分离】】】为角色编辑器填充关联项 (只能关联预设和其他)
     */
    function populateRoleAssociations(selectedIds = []) {
        presetDropdownList.innerHTML = '';

        // 【核心修改】从新的数据结构中获取所有可关联项
        const availableItems = [
            ...(presets.offlines || []),
            ...(presets.assets.writingStyles || []),
            ...(presets.assets.socialAssets || [])
        ];

        if (availableItems.length === 0) {
            presetDropdownList.innerHTML = `<div class="preset-dropdown-item" style="padding: 16px 12px;">暂无可关联项</div>`;
        } else {
            availableItems.forEach(item => {
                const isChecked = selectedIds.includes(item.id);
                const li = document.createElement('div');
                li.className = 'preset-dropdown-item';
                const checkboxId = `role_assoc_${item.id}`;
                li.innerHTML = `
                            <input type="checkbox" id="${checkboxId}" data-id="${item.id}" ${isChecked ? 'checked' : ''}>
                            <label for="${checkboxId}">${item.name}</label>
                        `;
                presetDropdownList.appendChild(li);
            });
        }
        updateDropdownLabel(selectedIds.length);
    }

    function updateDropdownLabel(count) {
        if (count > 0) {
            presetDropdownLabel.textContent = `已选择 ${count} 项`;
        } else {
            presetDropdownLabel.textContent = '点击选择';
        }
    }

    // --- 编辑器与列表交互 ---

    function openForbiddenWordsEditor() {
        forbiddenWordsPositionSelect.value = presets.forbiddenWords.position || 'all';
        forbiddenWordsContentInput.value = presets.forbiddenWords.content || '';
        showScreen('preset-forbidden-words-screen');
    }

    function presetEditInPlace(containerEl, textEl, isTextarea = false) {
        if (containerEl.querySelector('.preset-inplace-editor')) {
            return;
        }
        const originalText = textEl.textContent;
        textEl.style.display = 'none';

        const input = document.createElement(isTextarea ? 'textarea' : 'input');
        input.className = 'preset-inplace-editor';
        input.value = originalText;

        containerEl.appendChild(input);
        input.focus();

        const saveAndCleanup = () => {
            textEl.textContent = input.value;
            input.remove();
            textEl.style.display = '';
        };

        input.addEventListener('blur', saveAndCleanup);
        if (!isTextarea) {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') input.blur();
            });
        }
    }

    // ===================================================================
    // 【全新 V1.77.1】稳定版文件上传与情侣空间交互
    // ===================================================================

    // 【核心重构】为文件上传input设置唯一的“总调度员”事件监听器 (V1.98 最终修复版)
    desktopFileInput.addEventListener('change', (event) => {
        if (!currentImageUploadTarget) return;

        // 【核心修复】判断 currentImageUploadTarget 是否为包含 type 属性的对象
        if (typeof currentImageUploadTarget === 'object' && currentImageUploadTarget.type) {
            // 如果是世界书头像上传任务
            if (currentImageUploadTarget.type === 'role' || currentImageUploadTarget.type === 'forbidden-words') {
                handlePresetAvatarUpload(event);
            }
        }
        // 否则，执行旧的字符串判断逻辑
        else if (typeof currentImageUploadTarget === 'string') {
            if (currentImageUploadTarget.startsWith('polaroid-')) {
                handlePolaroidPhotoUpload(event);
            } else if (currentImageUploadTarget === 'couple-background') {
                handleCoupleBgUpload(event);
            } else if (currentImageUploadTarget.startsWith('icon-')) {
                handleAppIconUpload(event);
            } else {
                handleDesktopImageUpload(event);
            }
        }

        desktopFileInput.value = '';
    });

    // 为每个拍立得添加点击事件：只负责“设定目标”并“触发点击”
    polaroidItems.forEach((item, index) => {
        item.addEventListener('click', () => {
            currentImageUploadTarget = `polaroid-${index}`; // 设定目标
            currentPolaroidIndex = index; // 记录索引
            desktopFileInput.click(); // 触发文件选择
        });
    });

    // 监听“更换背景”按钮：只负责“设定目标”并“触发点击”
    if (themeBgUploadBtn) {
        themeBgUploadBtn.addEventListener('click', () => {
            currentImageUploadTarget = 'couple-background'; // 设定目标
            desktopFileInput.click(); // 触发文件选择
        });
    }

    // 监听“重置”按钮：【【【功能扩展】】】同时重置主背景和自定义区域背景
    if (themeResetBtn) {
        themeResetBtn.addEventListener('click', () => {
            showConfirmationModal('确定要重置所有背景吗？此操作将移除主背景和自定义区域背景。', () => {
                // 1. 重置主题数据（主背景）
                coupleSpaceTheme.background = '';
                saveCoupleThemeSettings();
                loadAndApplyCoupleTheme();

                // 2. 【【【全新】】】重置自定义区域背景数据
                if (coupleSpaceSettings.customBackground) {
                    coupleSpaceSettings.customBackground.image = '';
                }
                saveCoupleSpaceSettings();
                applyCoupleCustomBackground();

                alert('背景已重置。');
            });
        });
    }

    // --- 以下是情侣空间其他导航按钮的事件监听，保持不变 ---

    // 监听底部导航图标的点击
    if (coupleBottomNav) {
        navIconWrappers.forEach(icon => {
            icon.addEventListener('click', () => {
                const pageNumber = icon.dataset.page;
                switchCoupleContentPage(pageNumber);
            });
        });
    }

    // 监听顶栏“更多”按钮，跳转到主题设置页
    if (coupleSpaceOptionsBtn) {
        coupleSpaceOptionsBtn.addEventListener('click', () => {
            showScreen('couple-theme-screen');
        });
    }

    // 监听主题设置页的返回按钮
    if (coupleThemeBackBtn) {
        coupleThemeBackBtn.addEventListener('click', () => {
            showScreen('couple-space-screen');
        });
    }

    /**
* 【全新 V1.91 修复】专门处理应用图标上传的函数
*/
    function handleAppIconUpload(event) {
        const file = event.target.files[0];
        // 确保有文件，且上传目标是图标
        if (!file || !currentImageUploadTarget || !currentImageUploadTarget.startsWith('icon-')) return;

        // 从上传目标中解析出图标的key，例如 'icon-chat' -> 'chat'
        const iconKey = currentImageUploadTarget.replace('icon-', '');

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            // 确保该图标的设置对象存在
            if (!desktopIconSettings[iconKey]) {
                desktopIconSettings[iconKey] = {};
            }
            // 保存图片数据
            desktopIconSettings[iconKey].imageUrl = imageUrl;
            // 【核心】上传图片后，清空URL，因为图片的优先级更高
            desktopIconSettings[iconKey].url = '';

            // 并且清空界面上URL输入框的内容
            const urlInput = appIconSettingsContainer.querySelector(`.app-icon-url-input[data-icon-key="${iconKey}"]`);
            if (urlInput) urlInput.value = '';

            saveDesktopSettings(); // 保存到IndexedDB
            applyDesktopIconSettings(); // 立即刷新图标显示
        };
        reader.readAsDataURL(file);
    }

    // ===================================================================
    // 【全新 V1.91】外观设置 & 图标自定义核心功能函数
    // ===================================================================

    /**
     * 渲染“更换应用图标”页面的整个列表
     */
    function renderAppIconSettingsPage() {
        appIconSettingsContainer.innerHTML = ''; // 清空容器

        const iconConfig = [
            { key: 'chat', name: '聊天', defaultSvg: document.querySelector('.new-app-icon[data-target="chat-list-screen"]').innerHTML },
            { key: 'forum', name: '论坛', defaultSvg: document.querySelector('#main-apps-container .new-app-icon:nth-child(2)').innerHTML },
            { key: 'worldbook', name: '世界书', defaultSvg: document.querySelector('.new-app-icon[data-target="world-book-screen"]').innerHTML },
            { key: 'couple', name: '情侣空间', defaultSvg: document.querySelector('#main-apps-container .new-app-icon:nth-child(4)').innerHTML },
            { key: 'settings', name: '设置', defaultSvg: document.querySelector('.new-app-icon[data-target="main-settings-screen"]').innerHTML },
            { key: 'camera', name: '相机', defaultSvg: document.querySelector('#bottom-dock .new-app-icon:nth-child(2)').innerHTML },
            { key: 'message', name: '短信', defaultSvg: document.querySelector('#bottom-dock .new-app-icon:nth-child(3)').innerHTML },
            { key: 'phone', name: '电话', defaultSvg: document.querySelector('#bottom-dock .new-app-icon:nth-child(4)').innerHTML },
        ];

        iconConfig.forEach(config => {
            const settings = desktopIconSettings[config.key] || {};
            const item = document.createElement('div');
            item.className = 'app-icon-setting-item';
            item.innerHTML = `
                        <div class="app-icon-preview new-app-icon" data-icon-key="${config.key}">
                            <!-- 内容由 applyDesktopIconSettings 动态填充 -->
                        </div>
                        <div class="app-icon-details">
                            <span class="app-icon-setting-title">${config.name}</span>
                            <input type="text" class="app-icon-url-input" placeholder="粘贴URL可替换图标，优先级最高" value="${settings.url || ''}" data-icon-key="${config.key}">
                        </div>
                        <div class="app-icon-actions">
                            <button class="app-icon-btn app-icon-upload-btn" data-icon-key="${config.key}">
                                <svg t="1758199983802" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6733" width="25" height="25"><path d="M268.8 597.333333h51.2c12.8 0 21.333333-8.533333 21.333333-21.333333s-8.533333-21.333333-21.333333-21.333333H268.8c-17.066667 0-25.6 0-34.133333 4.266666-8.533333 4.266667-12.8 8.533333-17.066667 17.066667-4.266667 8.533333-4.266667 12.8-4.266667 34.133333v102.4c0 17.066667 0 25.6 4.266667 34.133334 4.266667 8.533333 8.533333 12.8 17.066667 17.066666 8.533333 4.266667 12.8 4.266667 34.133333 4.266667h486.4c17.066667 0 25.6 0 34.133333-4.266667 8.533333-4.266667 12.8-8.533333 17.066667-17.066666 4.266667-8.533333 4.266667-12.8 4.266667-34.133334v-102.4c0-17.066667 0-25.6-4.266667-34.133333-4.266667-8.533333-8.533333-12.8-17.066667-17.066667-8.533333-4.266667-12.8-4.266667-34.133333-4.266666h-51.2c-12.8 0-21.333333 8.533333-21.333333 21.333333s8.533333 21.333333 21.333333 21.333333H768V725.333333H256V610.133333 597.333333h12.8z" p-id="6734" fill="#ffffff"></path><path d="M533.333333 328.533333l85.333334 85.333334c8.533333 8.533333 21.333333 8.533333 29.866666 0 8.533333-8.533333 8.533333-21.333333 0-29.866667l-119.466666-119.466667c-8.533333-8.533333-21.333333-8.533333-29.866667 0L375.466667 384c-8.533333 8.533333-8.533333 21.333333 0 29.866667 8.533333 8.533333 21.333333 8.533333 29.866666 0l85.333334-85.333334v281.6c0 12.8 8.533333 21.333333 21.333333 21.333334s21.333333-8.533333 21.333333-21.333334V328.533333z" p-id="6735" fill="#ffffff"></path></svg>
                            </button>
                            <button class="app-icon-btn app-icon-reset-btn" data-icon-key="${config.key}">重置</button>
                        </div>
                    `;
            appIconSettingsContainer.appendChild(item);
        });

        // 渲染完成后，立即应用一次样式，确保预览块正确显示
        applyDesktopIconSettings();
    }

    /**
     * 【V1.92 最终性能优化版】根据数据，更新所有相关应用图标的样式
     */
    function applyDesktopIconSettings() {
        // 遍历我们已经缓存好的“地图”的key (chat, forum, worldbook, etc.)
        for (const key in iconConfigMap) {
            const settings = desktopIconSettings[key] || {};
            const elements = iconConfigMap[key]; // 直接从“地图”中取出元素列表，不再查询

            elements.forEach(iconEl => {
                if (!iconEl) return;

                // 优先级：URL > 上传图片 > 默认SVG
                if (settings.url) {
                    iconEl.style.backgroundImage = `url('${settings.url}')`;
                    iconEl.style.backgroundSize = 'cover';
                    iconEl.style.backgroundPosition = 'center';
                    iconEl.innerHTML = '';
                } else if (settings.imageUrl) {
                    iconEl.style.backgroundImage = `url('${settings.imageUrl}')`;
                    iconEl.style.backgroundSize = 'cover';
                    iconEl.style.backgroundPosition = 'center';
                    iconEl.innerHTML = '';
                } else {
                    // 恢复默认时，直接从我们的“备份仓库”中取货
                    iconEl.style.backgroundImage = 'none';
                    if (defaultIconSVGs[key]) {
                        iconEl.innerHTML = defaultIconSVGs[key];
                    }
                }
            });
        }
    }

    /**
     * 处理桌面壁纸上传和保存
     */
    function handleDesktopWallpaperUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = e => {
            const imageUrl = e.target.result;
            desktopWallpaperPreview.style.backgroundImage = `url(${imageUrl})`;
            removeDesktopWallpaperBtn.style.display = 'block';
        };
        reader.readAsDataURL(file);
        desktopWallpaperUploadInput.value = '';
    }

    // ===================================================================
    // 【V4.0 新增 & V4.3 修改】聊天列表页底部导航栏交互
    // ===================================================================
    const navItems = document.querySelectorAll('#chat-list-bottom-nav .nav-item');
    const listPages = document.querySelectorAll('.chat-list-page');
    const chatListScreenForNav = document.getElementById('chat-list-screen'); // 获取父容器

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const pageIdToShow = `${item.dataset.page}-page`;

            // 切换导航项的选中状态
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');

            // 切换页面的显示
            listPages.forEach(page => {
                if (page.id === pageIdToShow) {
                    // 【修改】根据页面ID决定 display 样式
                    page.style.display = (page.id === 'me-page') ? 'block' : 'flex';
                } else {
                    page.style.display = 'none';
                }
            });

            // 【【【核心新增】】】 根据是否为“Me”页面，添加或移除特殊类
            if (pageIdToShow === 'me-page') {
                chatListScreenForNav.classList.add('me-page-active');
            } else {
                chatListScreenForNav.classList.remove('me-page-active');
            }
        });
    });

    // ===================================================================
    // 【全新 V1.81】编辑模式核心逻辑
    // ===================================================================

    /**
     * 根据当前的设置，更新删除图标的可见性
     */
    function updateDeleteIconsVisibility() {
        // 检查拍立得
        polaroidItems.forEach((item, index) => {
            // 如果主题数据中有对应的图片链接，就标记为“已自定义”
            if (coupleSpaceTheme.polaroids && coupleSpaceTheme.polaroids[index]) {
                item.classList.add('is-customized');
            } else {
                item.classList.remove('is-customized');
            }
        });

        // 检查“我”的头像，这里的默认头像是代码里写死的，所以我们直接判断
        const defaultAvatarUrl = "https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp";
        if (coupleSpaceSettings.myAvatar && coupleSpaceSettings.myAvatar !== defaultAvatarUrl) {
            myAvatarWrapper.classList.add('is-customized');
        } else {
            myAvatarWrapper.classList.remove('is-customized');
        }
    }

    // 监听“编辑”按钮的点击
    if (coupleThemeEditBtn) {
        coupleThemeEditBtn.addEventListener('click', () => {
            // 1. 切换回情侣空间
            showScreen('couple-space-screen');
            // 2. 开启编辑模式
            coupleSpaceScreen.classList.add('edit-mode-active');
            // 3. 更新所有删除图标的显示状态
            updateDeleteIconsVisibility();
        });
    }

    // 使用事件委托，监听整个情侣空间页面的点击事件
    if (coupleSpaceScreen) {
        coupleSpaceScreen.addEventListener('click', (e) => {
            // --- A. 处理删除图标的点击 ---
            const deleteBtn = e.target.closest('.polaroid-delete-btn, .avatar-delete-btn');
            if (deleteBtn) {
                e.stopPropagation(); // 阻止事件冒泡，防止误触退出编辑模式

                // 如果点击的是拍立得的删除按钮
                if (deleteBtn.classList.contains('polaroid-delete-btn')) {
                    const polaroidItem = deleteBtn.closest('.polaroid-item');
                    const index = Array.from(polaroidItems).indexOf(polaroidItem);
                    if (index > -1) {
                        coupleSpaceTheme.polaroids[index] = ''; // 清空数据
                        saveCoupleThemeSettings();
                        loadAndApplyCoupleTheme(); // 重新加载以更新界面
                        polaroidItem.classList.remove('is-customized'); // 立即隐藏叉号
                    }
                }

                // 如果点击的是头像的删除按钮
                if (deleteBtn.classList.contains('avatar-delete-btn')) {
                    // 恢复为默认头像
                    coupleSpaceSettings.myAvatar = "https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp";
                    saveCoupleSpaceSettings();
                    loadCoupleSpaceSettings(); // 重新加载以更新界面
                    myAvatarWrapper.classList.remove('is-customized'); // 立即隐藏叉号
                }
                return; // 处理完毕，结束本次点击
            }

            // --- B. 处理退出编辑模式 ---
            // 如果当前是编辑模式，并且点击的不是任何可交互的元素，则退出编辑模式
            if (coupleSpaceScreen.classList.contains('edit-mode-active') && !e.target.closest('.polaroid-item, .couple-avatar-wrapper, .couple-bottom-nav')) {
                coupleSpaceScreen.classList.remove('edit-mode-active');
            }
        });
    }
    // ===================================================================
    // 【全新 V1.63】字体设置事件监听
    // ===================================================================
    gotoFontSettingsBtn.addEventListener('click', () => showScreen('font-settings-screen'));

    // 实时预览监听
    [globalFontSizeInput, globalFontWeightInput, globalLetterSpacingInput].forEach(input => {
        input.addEventListener('input', applyPreviewStyles);
    });

    // 添加新字体
    addFontBtn.addEventListener('click', () => {
        const url = fontUrlInput.value.trim();
        if (!url) {
            alert('请输入字体链接！');
            return;
        }
        const newFont = {
            id: 'font_' + Date.now() + Math.random(),
            name: '',
            url: url,
            isActive: false
        };
        fontSettings.customFonts.push(newFont);
        fontUrlInput.value = '';
        renderFontList();
        saveFontSettings();
    });

    // 字体列表的事件委托（处理删除和勾选）
    fontEntryList.addEventListener('click', (e) => {
        const fontItem = e.target.closest('.font-entry-item');
        if (!fontItem) return;
        const fontId = fontItem.dataset.fontId;

        // 点击删除按钮
        if (e.target.closest('.delete-font-btn')) {
            fontSettings.customFonts = fontSettings.customFonts.filter(f => f.id !== fontId);
            renderFontList();
            applyPreviewStyles();
            saveFontSettings();
        }

        // 点击勾选框
        if (e.target.closest('.font-entry-checkbox')) {
            const wasActive = fontSettings.customFonts.find(f => f.id === fontId)?.isActive;

            // 先把所有都设为不勾选
            fontSettings.customFonts.forEach(f => f.isActive = false);

            // 如果之前不是勾选状态，则把当前这个设为勾选
            if (!wasActive) {
                const targetFont = fontSettings.customFonts.find(f => f.id === fontId);
                if (targetFont) targetFont.isActive = true;
            }

            renderFontList();
            applyPreviewStyles();
            saveFontSettings();
        }
    });

    // 保存和恢复按钮
    saveFontSettingsBtn.addEventListener('click', () => {
        // 从输入框同步最新值到 settings 对象
        fontSettings.size = globalFontSizeInput.value || '16';
        fontSettings.weight = globalFontWeightInput.value || '400';
        fontSettings.spacing = globalLetterSpacingInput.value || '0';

        saveFontSettings();
        applyGlobalFontStyles();
        alert('字体效果已保存并应用！');
    });

    restoreFontDefaultsBtn.addEventListener('click', () => {
        showConfirmationModal('确定要恢复所有字体默认设置吗？此操作不可撤销。', () => {
            fontSettings = { size: '16', weight: '400', spacing: '0', customFonts: [] };
            saveFontSettings();
            loadFontSettings(); // 重新加载以更新UI
            applyGlobalFontStyles(); // 应用全局默认样式
            alert('已恢复默认设置。');
        });
    });

    appIcons.forEach(icon => {
        // 为普通app图标绑定跳转
        if (icon.dataset.target) {
            icon.addEventListener('click', () => showScreen(icon.dataset.target));
        }
    });

    // 【全新 V1.65】单独为桌面上的情侣空间图标绑定事件
    const coupleSpaceAppIcon = document.querySelector('#main-apps-container .new-app-icon:nth-child(4)'); // 假设情侣空间是第4个图标
    if (coupleSpaceAppIcon) {
        coupleSpaceAppIcon.addEventListener('click', () => {
            // 在这里可以加上判断是否已绑定的逻辑
            showScreen('couple-space-screen');
        });
    }

    backBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetScreenId = btn.dataset.target;

            // 【核心修复】如果目标是返回聊天列表，就自动关闭所有面板
            if (targetScreenId === 'chat-list-screen') {
                closeAllPanels();
            }

            // 【【【重大Bug修复】】】
            // 检查当前是否在聊天设置页面，并且将要返回聊天主界面
            if (document.getElementById('chat-settings-screen').classList.contains('active') && targetScreenId === 'chat-interface-screen') {
                // 在返回之前，先调用保存函数！
                saveCurrentChatSettings();
            }

            // 针对从设置页返回聊天页的特殊处理（这段保留）
            if (targetScreenId === 'chat-interface-screen') {
                applyChatStyles();
                renderMessages();
            }

            showScreen(targetScreenId);
        });
    });
    // ===================================================================
    // 【【【全新 V4.3】】】“Me”页面交互事件监听
    // ===================================================================

    // 1. 点击头像，触发专属的文件上传
    mePageAvatar.addEventListener('click', () => {
        meAvatarUploadInput.click();
    });

    // 2. 监听专属文件上传控件的变化
    meAvatarUploadInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            mePageData.avatar = imageUrl; // 更新数据
            saveMePageData();           // 保存数据
            applyMePageData();          // 立刻更新UI
        };
        reader.readAsDataURL(file);
        meAvatarUploadInput.value = ''; // 清空，以便下次上传
    });

    // 3. 为名字和签名绑定原地编辑功能
    mePageName.addEventListener('click', () => {
        // 调用你已有的 editInPlace 函数，但操作的是 mePageData 对象
        const tempInput = mePageName.parentNode.querySelector('.temp-edit-input');
        if (tempInput) return; // 防止重复点击

        const originalValue = (mePageData.name === 'Name') ? '' : mePageData.name;

        mePageName.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalValue;
        input.className = 'temp-edit-input';
        mePageName.parentNode.insertBefore(input, mePageName.nextSibling);
        input.focus();
        input.select();

        const save = () => {
            mePageData.name = input.value.trim() || 'Name'; // 保存新值，为空则恢复默认
            saveMePageData();
            applyMePageData(); // 用 apply 函数统一更新 UI
            input.remove();
            mePageName.style.display = 'block';
        };
        input.addEventListener('blur', save);
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') input.blur(); });
    });

    mePageSignature.addEventListener('click', () => {
        const tempInput = mePageSignature.parentNode.querySelector('.temp-edit-input');
        if (tempInput) return;

        const originalValue = (mePageData.signature === '点我输入自定义个性签名...') ? '' : mePageData.signature;

        mePageSignature.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalValue;
        input.className = 'temp-edit-input';
        mePageSignature.parentNode.insertBefore(input, mePageSignature.nextSibling);
        input.focus();
        input.select();

        const save = () => {
            mePageData.signature = input.value.trim() || '点我输入自定义个性签名...';
            saveMePageData();
            applyMePageData();
            input.remove();
            mePageSignature.style.display = 'block';
        };
        input.addEventListener('blur', save);
        input.addEventListener('keypress', (e) => { if (e.key === 'Enter') input.blur(); });
    });
    // 【新增】主设置页面的导航
    const gotoApiSettingsBtn = document.getElementById('goto-api-settings-btn');
    gotoApiSettingsBtn.addEventListener('click', () => showScreen('api-settings-screen'));

    // 【新增】为聊天界面的"..."按钮绑定事件
    chatSettingsBtn.addEventListener('click', openChatSettings);

    // 【全新 V2.03】为聊天设置页面的信息卡片添加点击事件
    aiInfoItem.addEventListener('click', (e) => {
        // 确保只有点击右侧箭头时才触发
        if (e.target.closest('.settings-arrow')) {
            openAiInfoScreen();
        }
    });
    userInfoItem.addEventListener('click', (e) => {
        if (e.target.closest('.settings-arrow')) {
            openMyInfoScreen();
        }
    });

    // 【全新 V2.03】为信息页面的保存按钮添加事件
    saveAiInfoBtn.addEventListener('click', saveAiInfo);
    saveMyInfoBtn.addEventListener('click', saveMyInfo);

    // 【全新 V2.03】信息页面关联角色书下拉框交互
    aiInfoAssociationsDropdown.addEventListener('click', (e) => {
        if (e.target.closest('.preset-dropdown-header')) {
            aiInfoAssociationsDropdown.classList.toggle('expanded');
        }
        if (e.target.matches('input[type="checkbox"]')) {
            const count = aiInfoAssociationsDropdown.querySelectorAll('.preset-dropdown-list input:checked').length;
            updateAiInfoDropdownLabel(count);
        }
    });

    // 【全新 V2.03】表情包库列表事件委托
    aiInfoStickerPackList.addEventListener('click', (e) => {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        const addBtn = e.target.closest('#add-sticker-pack-btn');
        const deleteBtn = e.target.closest('.delete-sticker-pack-btn');
        const packNameSpan = e.target.closest('.sticker-pack-name');
        const checkboxWrapper = e.target.closest('.sticker-pack-checkbox-wrapper');

        if (addBtn) {
            const newPack = {
                id: 'pack_' + Date.now() + Math.random(),
                name: '默认', // 新建时默认为“默认”，用户可进入管理页修改
                isDefault: false,
                enabled: true,
                stickers: []
            };
            chat.settings.stickerPacks.push(newPack);
            saveChats();
            renderStickerPacks(chat); // 重新渲染列表以显示新包
        } else if (deleteBtn) {
            const packId = deleteBtn.dataset.packId;
            chat.settings.stickerPacks = chat.settings.stickerPacks.filter(p => p.id !== packId);
            saveChats();
            renderStickerPacks(chat); // 重新渲染列表
        } else if (checkboxWrapper) {
            const packId = checkboxWrapper.dataset.packId;
            const pack = chat.settings.stickerPacks.find(p => p.id === packId);
            if (pack) {
                pack.enabled = !pack.enabled; // 切换状态
                saveChats();
                renderStickerPacks(chat); // 重新渲染以更新勾选状态
            }
        } else if (packNameSpan) {
            const packId = packNameSpan.dataset.packId;
            openManageStickersScreen(packId);
        }
    });

    // ===================================================================
    // 【全新 V2.06 修复版】管理表情页面事件
    // ===================================================================

    // 标题修改
    stickerPackTitleEditor.addEventListener('blur', () => {
        const { chatId, packId } = currentManagingStickerPack;
        const chat = chats.find(c => c.id === chatId);
        const pack = chat?.settings.stickerPacks.find(p => p.id === packId);
        if (pack && !pack.isDefault) {
            pack.name = stickerPackTitleEditor.textContent.trim() || '未命名';
            saveChats();
            // 刷新外面的列表，以便名字同步
            const currentChatForRender = chats.find(c => c.id === activeChatId);
            if (currentChatForRender) renderStickerPacks(currentChatForRender);
        }
    });

    // 添加表情
    stickerManagementGridView.addEventListener('click', (e) => {
        if (e.target.closest('.add-sticker-btn-wrapper')) {
            // 复用全局的添加表情弹窗，并告诉它上下文是 'pack'
            openNewAddStickerModal('pack');
        }
    });

    // 删除模式切换
    stickerDeleteModeBtn.addEventListener('click', () => {
        manageStickersScreen.classList.add('delete-mode');
        stickerDeleteModeBtn.style.display = 'none';
        deleteModeActions.style.display = 'flex';
    });

    cancelStickerDeleteBtn.addEventListener('click', () => {
        manageStickersScreen.classList.remove('delete-mode');
        stickerDeleteModeBtn.style.display = 'block';
        deleteModeActions.style.display = 'none';
        // 清除所有勾选
        stickerManagementGridView.querySelectorAll('.sticker-delete-checkbox').forEach(cb => {
            cb.classList.remove('checked');
            cb.innerHTML = '';
        });
    });

    // 表情勾选
    stickerManagementGridView.addEventListener('click', (e) => {
        const checkbox = e.target.closest('.sticker-delete-checkbox');
        if (checkbox && manageStickersScreen.classList.contains('delete-mode')) {
            checkbox.classList.toggle('checked');
            if (checkbox.classList.contains('checked')) {
                checkbox.innerHTML = '<svg t="1757638693998" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="26732" width="14" height="14"><path d="M384 768c-12.8 0-21.333333-4.266667-29.866667-12.8l-213.333333-213.333333c-17.066667-17.066667-17.066667-42.666667 0-59.733334s42.666667-17.066667 59.733333 0L384 665.6 823.466667 226.133333c17.066667-17.066667 42.666667-17.066667 59.733333 0s17.066667 42.666667 0 59.733334l-469.333333 469.333333c-8.533333 8.533333-17.066667 12.8-29.866667 12.8z" p-id="26733" fill="#ffffff"></path></svg>';
            } else {
                checkbox.innerHTML = '';
            }
        }
    });

    // 确认删除表情
    confirmStickerDeleteBtn.addEventListener('click', () => {
        const { chatId, packId } = currentManagingStickerPack;
        const chat = chats.find(c => c.id === chatId);
        const pack = chat?.settings.stickerPacks.find(p => p.id === packId);

        const checkedStickers = Array.from(stickerManagementGridView.querySelectorAll('.sticker-delete-checkbox.checked'));
        if (checkedStickers.length === 0) {
            alert('请先勾选要删除的表情。');
            return;
        }

        const idsToDelete = new Set(checkedStickers.map(cb => cb.dataset.stickerId));
        pack.stickers = pack.stickers.filter(s => !idsToDelete.has(s.id));

        saveChats();
        renderStickerManagementGrid(pack.stickers); // 刷新界面
        // 退出删除模式
        manageStickersScreen.classList.remove('delete-mode');
        stickerDeleteModeBtn.style.display = 'block';
        deleteModeActions.style.display = 'none';
    });

    // 【新增】保存聊天设置页的修改 (当用户离开输入框时自动保存)
    showAvatarsToggle.addEventListener('change', saveCurrentChatSettings);
    avatarRadiusInput.addEventListener('blur', saveCurrentChatSettings);
    fontSizeInput.addEventListener('blur', saveCurrentChatSettings);


    avatarUploadInput.addEventListener('change', handleAvatarUpload);

    // 【新增】清空聊天记录
    // 【新增】显示自定义确认弹窗的函数
    function showConfirmationModal(text, onConfirm) {
        const confirmModal = document.getElementById('confirm-modal');
        const confirmText = document.getElementById('confirm-modal-text');
        const confirmBtn = document.getElementById('confirm-modal-confirm-btn');
        const cancelBtn = document.getElementById('confirm-modal-cancel-btn');

        confirmText.textContent = text;

        // 核心修复：为“确定”按钮创建一个干净的克隆版本
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

        const closeModal = () => confirmModal.classList.remove('visible');

        // 只为全新的按钮添加事件监听
        newConfirmBtn.addEventListener('click', () => {
            // 【核心修复】使用一个微小的、非零的延迟来强制分离事件和操作
            setTimeout(() => {
                onConfirm();
                closeModal();
            }, 20); // 使用20毫秒延迟
        });

        // 取消按钮的事件可以保持不变，因为它逻辑简单
        cancelBtn.onclick = closeModal;

        // 最后再显示弹窗
        confirmModal.classList.add('visible');
    }
    // 【修改】清空聊天记录事件
    clearHistoryBtn.addEventListener('click', () => {
        const chat = chats.find(c => c.id === activeChatId);
        if (chat) {
            showConfirmationModal(`确定要清空与 ${chat.settings.aiName || chat.name} 的聊天记录？`, () => {
                chat.history = [];
                saveChats();
                renderMessages();
                renderContactList(); // 【核心修复】在这里补上列表刷新指令
            });
        }
    });

    // 【新增】气泡样式弹窗事件
    openBubbleStyleModalBtn.addEventListener('click', openBubbleStyleModal);
    [userBubbleColorInput, aiBubbleColorInput, userFontColorInput, aiFontColorInput, customCssInput].forEach(el => {
        el.addEventListener('input', updateBubblePreview);
    });

    // 【新增】为新按钮和颜色选择器添加事件监听
    const resetColorsBtn = document.getElementById('reset-colors-btn');
    const resetCssBtn = document.getElementById('reset-css-btn');

    resetColorsBtn.addEventListener('click', () => {
        bubbleStyleModal.dataset.isColorSet = 'false'; // 标记为“颜色未设置”
        // 重置所有颜色输入框的值
        userBubbleColorInput.value = '#ffffff';
        aiBubbleColorInput.value = '#ffffff';
        userFontColorInput.value = '#262626';
        aiFontColorInput.value = '#262626';
        updateBubblePreview(); // 更新预览，它会显示默认样式
    });

    resetCssBtn.addEventListener('click', () => {
        customCssInput.value = ''; // 清空CSS输入框
        updateBubblePreview(); // 更新预览
    });

    // 当用户手动修改颜色时，自动将状态切换为“颜色已设置”
    userBubbleColorInput.addEventListener('input', () => {
        bubbleStyleModal.dataset.isColorSet = 'true';
    });
    aiBubbleColorInput.addEventListener('input', () => {
        bubbleStyleModal.dataset.isColorSet = 'true';
    });

    // 当用户手动修改字体颜色时，同样自动将状态切换为“颜色已设置”
    userFontColorInput.addEventListener('input', () => {
        bubbleStyleModal.dataset.isColorSet = 'true';
    });
    aiFontColorInput.addEventListener('input', () => {
        bubbleStyleModal.dataset.isColorSet = 'true';
    });

    saveBubbleStyleBtn.addEventListener('click', () => {
        const chat = chats.find(c => c.id === activeChatId);
        if (chat) {
            const isColorSet = bubbleStyleModal.dataset.isColorSet === 'true';

            // 如果自定义颜色是启用的，就保存颜色值；否则，保存空字符串
            chat.settings.userBubbleColor = isColorSet ? userBubbleColorInput.value : '';
            chat.settings.aiBubbleColor = isColorSet ? aiBubbleColorInput.value : '';
            chat.settings.userFontColor = isColorSet ? userFontColorInput.value : ''; // 新增
            chat.settings.aiFontColor = isColorSet ? aiFontColorInput.value : '';   // 新增

            chat.settings.customCss = customCssInput.value;
            saveChats();
            applyChatStyles(); // 应用刚刚保存的最新样式
            bubbleStyleModal.classList.remove('visible');
        }
    });

    // 【新增】背景设置弹窗事件
    openBackgroundModalBtn.addEventListener('click', openBackgroundModal);
    backgroundPreview.addEventListener('click', () => backgroundUploadInput.click());
    backgroundUploadInput.addEventListener('change', handleBackgroundUpload);
    removeBackgroundBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 防止触发 backgroundPreview 的点击事件
        backgroundPreview.style.backgroundImage = 'none';
        removeBackgroundBtn.style.display = 'none';
    });
    saveBackgroundBtn.addEventListener('click', () => {
        const chat = chats.find(c => c.id === activeChatId);
        if (chat) {
            // 将样式中的url()提取出来
            const bgStyle = backgroundPreview.style.backgroundImage;
            chat.settings.background = bgStyle.startsWith('url') ? bgStyle.slice(5, -2) : '';
            saveChats();
            applyChatStyles();
            backgroundModal.classList.remove('visible');
        }
    });

    // 【新增】关闭所有弹窗的通用逻辑
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) { // 点击背景关闭
                modal.classList.remove('visible');
            }
        });
        modal.querySelectorAll('.modal-cancel-btn, .modal-card-close-btn').forEach(btn => {
            btn.addEventListener('click', () => modal.classList.remove('visible'));
        });
    });

    saveSettingsBtn.addEventListener('click', saveSettings);
    fetchModelsBtn.addEventListener('click', fetchModels);

    addContactBtn.addEventListener('click', openCreateContactModal);
    confirmCreateBtn.addEventListener('click', handleCreateNewContact);
    cancelCreateBtn.addEventListener('click', () => addContactModal.classList.remove('visible'));
    newContactNameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleCreateNewContact();
    });

    sendBtn.addEventListener('click', handleSendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });
    generateBtn.addEventListener('click', handleGenerateReply);


    // ===================================================================
    // 【V1.50 新增】桌面交互事件监听
    // ===================================================================

    // 监听全局桌面文件上传工具
    desktopFileInput.addEventListener('change', handleDesktopImageUpload);

    // -- 图片上传事件绑定 --
    userCardBackground.addEventListener('click', () => {
        currentImageUploadTarget = 'userBackground';
        desktopFileInput.click();
    });
    userCardAvatar.addEventListener('click', () => {
        currentImageUploadTarget = 'userAvatar';
        desktopFileInput.click();
    });
    recordInner.addEventListener('click', () => {
        currentImageUploadTarget = 'recordInner';
        desktopFileInput.click();
    });
    capsuleIcon.addEventListener('click', () => {
        currentImageUploadTarget = 'capsuleIcon1';
        desktopFileInput.click();
    });

    // -- 文本编辑事件绑定 (已全部更新为新版) --
    userIdText.addEventListener('click', () => {
        editInPlace(userIdText, 'userId', 'Name');
    });
    userHandleText.addEventListener('click', () => {
        editInPlace(userHandleText, 'userHandle', '...', true);
    });
    userBioText.addEventListener('click', () => {
        editInPlace(userBioText, 'userBio', '自定义文案');
    });
    userLocationText.addEventListener('click', () => {
        editInPlace(userLocationText, 'userLocation', '...');
    });
    capsuleText.addEventListener('click', () => {
        editInPlace(capsuleText, 'capsuleText1', '');
    });

    // ===================================================================
    // 【V1.50 新增】桌面交互核心功能函数
    // ===================================================================

    /**
     * 【V1.81 最终修复版】保存桌面设置到 IndexedDB
     */
    async function saveDesktopSettings() {
        try {
            // 保存通用的桌面文本和图片设置
            await db.set('desktopSettings', desktopSettings);
            // 单独保存桌面壁纸
            await db.set('desktopWallpaper', desktopWallpaper);
            // 单独保存应用图标设置
            await db.set('desktopIconSettings', desktopIconSettings);
        } catch (error) {
            console.error("Failed to save desktop data to IndexedDB:", error);
            alert("保存桌面数据失败，可能是存储空间问题。");
        }
    }

    /**
     * 【V1.81 最终修复版】从 IndexedDB 加载桌面设置并应用
     */
    async function loadDesktopSettings() {
        // 加载通用设置
        const savedSettings = await db.get('desktopSettings') || {};
        desktopSettings = {
            userBackground: savedSettings.userBackground || '',
            userAvatar: savedSettings.userAvatar || '',
            userId: savedSettings.userId || 'Name',
            userHandle: savedSettings.userHandle || '...',
            userBio: savedSettings.userBio || '自定义文案',
            userLocation: savedSettings.userLocation || '...',
            capsuleIcon1: savedSettings.capsuleIcon1 || '',
            capsuleText1: savedSettings.capsuleText1 || '',
            recordInner: savedSettings.recordInner || ''
        };

        // 单独加载桌面壁纸
        desktopWallpaper = await db.get('desktopWallpaper') || '';
        // 单独加载图标设置
        desktopIconSettings = await db.get('desktopIconSettings') || {};
    }

    /**
     * 将 desktopSettings 对象中的数据显示在界面上
     */
    function applyDesktopSettings() {
        // 应用桌面壁纸
        const homeScreen = document.getElementById('home-screen');
        if (desktopWallpaper) {
            homeScreen.style.backgroundImage = `url(${desktopWallpaper})`;
            homeScreen.style.backgroundSize = 'cover';
            homeScreen.style.backgroundPosition = 'center';
        } else {
            homeScreen.style.backgroundImage = 'none';
            // 如果需要默认颜色，可以在这里设置
            // homeScreen.style.backgroundColor = '#a8d8f0'; 
        }

        // 应用卡片背景图片
        if (desktopSettings.userBackground) {
            userCardBackground.style.backgroundImage = `url(${desktopSettings.userBackground})`;
            userCardBackground.style.backgroundSize = 'cover';
            userCardBackground.style.backgroundPosition = 'center';
        } else {
            userCardBackground.style.backgroundImage = 'none';
        }

        // 应用头像
        if (desktopSettings.userAvatar) {
            userCardAvatar.style.backgroundImage = `url(${desktopSettings.userAvatar})`;
            userCardAvatar.style.backgroundSize = 'cover';
            userCardAvatar.style.backgroundPosition = 'center';
            userCardAvatar.innerHTML = ''; // 清空默认的SVG图标
        }

        // 应用黑胶唱片图片
        if (desktopSettings.recordInner) {
            recordInner.style.backgroundImage = `url(${desktopSettings.recordInner})`;
            recordInner.style.backgroundSize = 'cover';
            recordInner.style.backgroundPosition = 'center';
        } else {
            recordInner.style.backgroundImage = 'none';
        }

        // 应用矩形条图标
        if (desktopSettings.capsuleIcon1) {
            capsuleIcon.style.backgroundImage = `url(${desktopSettings.capsuleIcon1})`;
        } else {
            capsuleIcon.style.backgroundImage = 'none';
        }

        // 应用所有文本
        userIdText.textContent = desktopSettings.userId;
        userHandleText.textContent = '@' + desktopSettings.userHandle;
        userBioText.textContent = desktopSettings.userBio;
        userLocationText.textContent = desktopSettings.userLocation;
        capsuleText.textContent = desktopSettings.capsuleText1;

        // 【核心新增】应用所有图标的自定义样式
        applyDesktopIconSettings();
    }

    /**
     * 处理所有桌面图片的上传
     * @param {Event} event - 文件输入框的 change 事件
     */
    function handleDesktopImageUpload(event) {
        const file = event.target.files[0];
        if (!file || !currentImageUploadTarget) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result; // 图片的 Base64 Data URL

            // 根据之前记录的目标，更新设置并保存
            desktopSettings[currentImageUploadTarget] = imageUrl;
            saveDesktopSettings();

            // 立即应用更改
            applyDesktopSettings();
        };
        reader.readAsDataURL(file);
        desktopFileInput.value = ''; // 清空以便下次上传
    }

    /**
     * 【全新】通用文本原地编辑函数
     * @param {HTMLElement} element - 要修改的HTML元素
     * @param {string} settingKey - 在 desktopSettings 中对应的键名
     * @param {string} defaultValue - 默认文本
     * @param {boolean} isHandle - 是否是特殊处理的@handle
     */
    function editInPlace(element, settingKey, defaultValue, isHandle = false) {
        // 如果当前已经在编辑中，则阻止再次触发
        if (element.style.display === 'none') {
            return;
        }

        const originalValue = desktopSettings[settingKey] || defaultValue;

        element.style.display = 'none'; // 隐藏原始文本

        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalValue;
        input.className = 'temp-edit-input';

        if (isHandle) {
            input.value = desktopSettings[settingKey] || '...';
        }

        // 将输入框插入到原始文本后面
        element.parentNode.insertBefore(input, element.nextSibling);
        input.focus(); // 自动聚焦
        input.select(); // 全选文字方便修改

        // 定义保存和清理函数
        const saveAndCleanup = () => {
            const newValue = input.value.trim();
            const finalValue = (newValue === '') ? defaultValue : newValue;

            desktopSettings[settingKey] = finalValue;
            saveDesktopSettings();

            if (isHandle) {
                element.textContent = '@' + finalValue;
            } else {
                element.textContent = finalValue;
            }

            // 移除输入框，显示原始文本
            input.remove();
            element.style.display = '';
        };

        input.addEventListener('blur', saveAndCleanup); // 当输入框失去焦点时保存
        input.addEventListener('keypress', (e) => { // 当按下回车时保存
            if (e.key === 'Enter') {
                input.blur(); // 触发 blur 事件即可
            }
        });
    }

    // ===================================================================
    // 【全新 V1.81 修复方案】表情系统独立“遥控器” (方案一) - 最终完整修复版
    // ===================================================================



    // --- 2. 编写全新的、独立的函数 ---
    async function saveStickers() {
        try {
            await db.set('stickers', stickers); // 从 localStorage 改为 IndexedDB
        } catch (error) {
            console.error("Failed to save stickers to IndexedDB:", error);
            alert("保存表情数据失败，可能是存储空间问题。");
        }
    }

    async function loadStickers() {
        const savedStickers = await db.get('stickers'); // 从 localStorage 改为 IndexedDB
        stickers = savedStickers || [];
        renderStickerPanel();
    }

    function renderStickerPanel() {
        stickerGrid.innerHTML = '';
        const addBtnWrapper = document.createElement('div');
        addBtnWrapper.className = 'add-sticker-btn-wrapper';
        addBtnWrapper.innerHTML = `<svg t="1757458251149" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path d="M902.343 570.936h-331.78v331.833c0 32.337-26.226 58.537-58.564 58.537-32.337 0-58.563-26.2-58.563-58.537V570.936H121.654c-32.364 0-58.564-26.2-58.564-58.538 0-32.325 26.203-58.537 58.564-58.537h331.78V122.028c0-32.325 26.226-58.537 58.563-58.537 32.338 0 58.564 26.213 58.564 58.537v331.834h331.78c32.364 0 58.565 26.211 58.565 58.535-0.001 32.337-26.2 58.536-58.565 58.536z" fill="#353333"></path></svg>`;
        stickerGrid.appendChild(addBtnWrapper);

        stickers.forEach(sticker => {
            const stickerItem = document.createElement('div');
            stickerItem.className = 'sticker-item';
            stickerItem.dataset.stickerId = sticker.id;
            stickerItem.dataset.stickerUrl = sticker.url;
            stickerItem.innerHTML = `
                        <img src="${sticker.url}" alt="${sticker.name}" style="pointer-events: none;">
                        <button class="sticker-delete-btn" data-sticker-id="${sticker.id}" data-sticker-name="${sticker.name}">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="pointer-events: none;"><path d="M18 6L6 18M6 6l12 12" stroke="#888" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        </button>
                    `;
            stickerGrid.appendChild(stickerItem);
        });
    }

    function handleStickerFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = e => {
            stickerFileAsDataUrl = e.target.result;
            newStickerUrlInput.placeholder = "已选择本地图片，可忽略此链接框";
        };
        reader.readAsDataURL(file);
    }

    function openNewAddStickerModal(context = 'global') {
        currentStickerAddContext = context; // 核心：记录下当前的上下文
        newStickerNameInput.value = '';
        newStickerUrlInput.value = '';
        newStickerUrlInput.placeholder = "粘贴图片URL，或点击下方按钮上传";
        stickerFileAsDataUrl = null;
        stickerFileInput.value = '';
        newAddStickerModal.classList.add('visible');
    }

    // --- 3. 为新弹窗和面板绑定全新的、独立的事件 ---
    newStickerUploadBtn.addEventListener('click', () => stickerFileInput.click());

    // 【核心修复】为隐藏的文件选择框绑定 change 事件监听器
    stickerFileInput.addEventListener('change', handleStickerFileUpload);

    /**
     * 【全新 V1.97】处理世界书头像上传的专用函数
     */
    function handlePresetAvatarUpload(event) {
        const file = event.target.files[0];
        if (!file || !currentImageUploadTarget) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            const targetType = currentImageUploadTarget.type;
            const targetId = currentImageUploadTarget.id;

            if (targetType === 'role') {
                const preset = presets.roles.find(p => p.id === targetId);
                if (preset) {
                    preset.avatar = imageUrl;
                }
            } else if (targetType === 'forbidden-words') {
                // 【核心新增】为禁词数据对象添加头像URL
                presets.forbiddenWords.avatar = imageUrl;
            }

            savePresets(); // 保存到 IndexedDB
            renderRolePresetsPage(); // 刷新列表以显示新头像
        };
        reader.readAsDataURL(file);
    }

    // 【全新 V1.91 修复】将桌面文件上传逻辑整合到一个总的事件监听器中
    desktopFileInput.addEventListener('change', (event) => {
        // 如果没有设置上传目标，则直接返回
        if (!currentImageUploadTarget) return;

        // 根据不同的上传目标，调用不同的处理函数
        if (currentImageUploadTarget.type === 'role' || currentImageUploadTarget.type === 'forbidden-words') {
            handlePresetAvatarUpload(event);
        }
        else if (currentImageUploadTarget.startsWith('polaroid-')) {
            handlePolaroidPhotoUpload(event);
        } else if (currentImageUploadTarget === 'couple-background') {
            handleCoupleBgUpload(event);
        } else if (currentImageUploadTarget.startsWith('icon-')) {
            // 如果目标是应用图标，就调用我们刚刚创建的新函数
            handleAppIconUpload(event);
        } else {
            // 其他情况（如用户头像、卡片背景等）调用通用的桌面图片处理函数
            handleDesktopImageUpload(event);
        }

        // 无论上传了什么，最后都要清空文件输入框，以便下次可以上传同一个文件
        desktopFileInput.value = '';
    });

    // 为弹窗的关闭和取消按钮添加事件
    newAddStickerModal.querySelector('.modal-card-close-btn').addEventListener('click', () => newAddStickerModal.classList.remove('visible'));
    newAddStickerModal.querySelector('.modal-cancel-btn').addEventListener('click', () => newAddStickerModal.classList.remove('visible'));

    // 【修改】为“保存表情”按钮绑定新的、更完善的逻辑
    newStickerSaveBtn.addEventListener('click', () => {
        const name = newStickerNameInput.value.trim();
        const url = newStickerUrlInput.value.trim();
        if (!name) { alert('请为表情命名！'); return; }
        if (!url && !stickerFileAsDataUrl) { alert('请提供图片链接或上传图片！'); return; }

        // 核心：检查我们之前记录的上下文
        if (currentStickerAddContext === 'pack') {
            // 如果上下文是 'pack'，则调用添加到包的函数
            addStickerToCurrentPack(name, stickerFileAsDataUrl || url);
        } else {
            // 否则 (上下文是 'global')，执行添加到全局表情的逻辑
            const newSticker = { id: 'sticker_' + Date.now() + Math.random(), name: name, url: stickerFileAsDataUrl || url };
            stickers.push(newSticker);
            saveStickers();
            renderStickerPanel(); // 刷新聊天界面的表情面板
        }

        newAddStickerModal.classList.remove('visible');
    });

    // --- 4. 建立表情面板交互的全新“遥控器” (使用Pointer Events) - V1.81 最终修复版 ---
    let pressTimer = null;
    let isPressing = false;
    let hasMoved = false;

    stickerGrid.addEventListener('pointerdown', (e) => {
        // 【核心修复 #1】: 简化启动逻辑。只要是在 stickerGrid 内按下的，都启动计时器。
        isPressing = true;
        hasMoved = false;

        const stickerItem = e.target.closest('.sticker-item');
        // 长按逻辑只对表情项生效
        if (stickerItem) {
            pressTimer = setTimeout(() => {
                if (isPressing && !hasMoved) {
                    stickerItem.classList.toggle('show-delete');
                    stickerGrid.querySelectorAll('.sticker-item.show-delete').forEach(item => {
                        if (item !== stickerItem) item.classList.remove('show-delete');
                    });
                    isPressing = false;
                }
            }, 350);
        }
    });

    stickerGrid.addEventListener('pointermove', () => {
        if (isPressing) {
            hasMoved = true;
            clearTimeout(pressTimer);
        }
    });

    stickerGrid.addEventListener('pointerup', (e) => {
        if (isPressing && !hasMoved) {
            e.preventDefault();

            const addBtn = e.target.closest('.add-sticker-btn-wrapper');
            const deleteBtn = e.target.closest('.sticker-delete-btn');
            const stickerItem = e.target.closest('.sticker-item');

            // 【核心修复 #2】: 现在的判断逻辑将完全正常
            if (deleteBtn) {
                const stickerId = deleteBtn.dataset.stickerId;
                const stickerName = deleteBtn.dataset.stickerName;
                showConfirmationModal(`确定要删除表情 “${stickerName}” 吗？`, () => {
                    stickers = stickers.filter(s => s.id !== stickerId);
                    saveStickers();
                    renderStickerPanel();
                });
            } else if (addBtn) {
                openNewAddStickerModal('global'); // 明确指定上下文是 'global'
            } else if (stickerItem) {
                if (stickerItem.classList.contains('show-delete')) {
                    stickerItem.classList.remove('show-delete');
                } else {
                    sendSticker(stickerItem.dataset.stickerUrl);
                }
            }
        }
        clearTimeout(pressTimer);
        isPressing = false;
    });

    stickerGrid.addEventListener('pointercancel', () => {
        clearTimeout(pressTimer);
        isPressing = false;
    });

    // 【新增】点击聊天界面空白处，取消表情删除状态
    document.getElementById('chat-interface-screen').addEventListener('click', (e) => {
        // 检查当前是否有表情处于删除模式，并且点击的不是表情网格内部
        const hasDeleteModeSticker = stickerGrid.querySelector('.sticker-item.show-delete');
        const isClickInsideGrid = stickerGrid.contains(e.target);

        if (hasDeleteModeSticker && !isClickInsideGrid) {
            hasDeleteModeSticker.classList.remove('show-delete');
        }
    });

    // ===================================================================
    // 【全新】功能面板事件监听
    // ===================================================================
    moreFunctionsBtn.addEventListener('click', togglePanels); // 修改：使用新的总控制函数
    functionsNavPrev.addEventListener('click', () => navigateFunctionsPanel(-1));
    functionsNavNext.addEventListener('click', () => navigateFunctionsPanel(1));

    // ===================================================================
    // 【全新 V1.65】情侣空间事件监听
    // ===================================================================
    // 点击我方头像，触发文件上传
    myAvatarWrapper.addEventListener('click', () => {
        coupleAvatarUploadInput.click();
    });
    coupleAvatarUploadInput.addEventListener('change', handleCoupleAvatarUpload);

    // 点击对方“+”头像，渲染并跳转到邀请列表
    partnerAvatarWrapper.addEventListener('click', () => {
        // 【【【核心修复 V2.62】】】
        // 只有在未绑定状态下，点击才执行跳转逻辑
        if (!coupleSpaceSettings.partnerChatId) {
            renderCoupleInviteList();
            showScreen(partnerAvatarWrapper.dataset.target);
        } else {
            // 如果已绑定，点击事件由另一个监听器处理（弹出解绑气泡）
            // 这里不需要做任何事
        }
    });

    // 【新增】更新状态栏时间
    function updateTime() {
        const timeEl = document.getElementById('status-bar-time');
        if (timeEl) {
            const now = new Date();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            timeEl.textContent = `${hours}:${minutes}`;
        }
    }

    // ===================================================================
    // 【全新 V1.57】手机框显示/隐藏逻辑
    // ===================================================================

    /**
     * 根据传入的状态，应用或移除手机框样式
     * @param {boolean} show - 是否显示手机框
     */
    function applyPhoneFrameState(show) {
        // 获取html元素
        const htmlElement = document.documentElement;

        if (show) {
            document.body.classList.add('phone-frame-visible');
            htmlElement.classList.add('phone-frame-visible'); // 【新增】给html也加上类
        } else {
            document.body.classList.remove('phone-frame-visible');
            htmlElement.classList.remove('phone-frame-visible'); // 【新增】从html移除类
        }
        // 确保开关的状态与实际显示状态同步
        if (phoneFrameToggle) {
            phoneFrameToggle.checked = show;
        }
    }

    /**
     * 【V1.81 最终修复版】从 IndexedDB 加载手机框的设置
     */
    async function loadPhoneFrameSetting() {
        const shouldShowFrame = await db.get('showPhoneFrame');
        // 如果数据库中没有值(undefined)，则默认为 false
        applyPhoneFrameState(shouldShowFrame === true);
    }

    // --- 事件监听 ---
    // 为手机框开关绑定事件 (使用 IndexedDB)
    if (phoneFrameToggle) {
        phoneFrameToggle.addEventListener('change', async () => { // 修改为 async
            const shouldShow = phoneFrameToggle.checked;
            await db.set('showPhoneFrame', shouldShow); // 修改
            applyPhoneFrameState(shouldShow);
        });
    }
    // ===================================================================
    // 【全新 V2.21】世界书功能事件监听 (重构版)
    // ===================================================================
    // --- 页面切换与顶部按钮控制 ---
    const addNewRoleBtn = document.getElementById('add-new-role-btn');
    const addNewOfflinePresetBtn = document.getElementById('add-new-offline-preset-btn');

    presetBottomNav.addEventListener('click', (e) => {
        const navItem = e.target.closest('.preset-nav-item');
        if (!navItem) return;

        presetBottomNav.querySelectorAll('.preset-nav-item').forEach(item => item.classList.remove('active'));
        presetPages.forEach(page => page.classList.remove('active'));

        const pageName = navItem.dataset.page;
        navItem.classList.add('active');
        document.getElementById(`preset-page-${pageName}`).classList.add('active');

        // 【核心】根据页面控制“+”号的显隐
        addNewRoleBtn.style.display = (pageName === 'role') ? 'flex' : 'none';
        addNewOfflinePresetBtn.style.display = (pageName === 'offline') ? 'flex' : 'none';

        // 【新增】素材页面没有顶栏加号，所以切换到其他页面时要确保它们是隐藏的
        if (pageName === 'assets') {
            addNewRoleBtn.style.display = 'none';
            addNewOfflinePresetBtn.style.display = 'none';
        }
    });

    // --- 列表页事件委托 ---
    presetPageRole.addEventListener('click', (e) => {
        const target = e.target;
        const button = target.closest('button');
        const avatar = target.closest('.preset-list-avatar');

        if (button) {
            const action = button.dataset.action;
            const id = button.dataset.id;
            if (action === 'edit-role') openRolePresetEditor(id);
            else if (action === 'delete-role') {
                showConfirmationModal(`确定要删除该角色吗？`, () => {
                    presets.roles = presets.roles.filter(p => p.id !== id);
                    savePresets();
                    renderRolePresetsPage();
                });
            } else if (action === 'edit-forbidden-words') {
                openForbiddenWordsEditor();
            }
        } else if (avatar) {
            currentImageUploadTarget = { type: avatar.dataset.type, id: avatar.dataset.id };
            desktopFileInput.click();
        }
    });

    // 【【【核心新增】】】为“预设”页面添加事件委托
    const presetPageOffline = document.getElementById('preset-page-offline');
    presetPageOffline.addEventListener('click', (e) => {
        const target = e.target;
        const button = target.closest('button');

        if (target.matches('input[data-action="toggle-offline-preset"]')) {
            const id = target.dataset.id;
            const preset = presets.offlines.find(p => p.id === id);
            if (preset) {
                preset.enabled = target.checked;
                savePresets();
            }
        } else if (button) {
            const action = button.dataset.action;
            const id = button.dataset.id;
            if (action === 'edit-offline-preset') {
                openOfflinePresetEditor(id);
            } else if (action === 'delete-offline-preset') {
                showConfirmationModal(`确定要删除该预设吗？`, () => {
                    presets.offlines = presets.offlines.filter(p => p.id !== id);
                    savePresets();
                    renderOfflinePresetsPage();
                });
            }
        }
    });


    // --- 编辑器开启 ---
    addNewRoleBtn.addEventListener('click', () => openRolePresetEditor(null));
    addNewOfflinePresetBtn.addEventListener('click', () => openOfflinePresetEditor(null));

    // --- 编辑器保存 ---
    saveRolePresetBtn.addEventListener('click', () => {
        const name = presetNameText.textContent.trim();
        if (!name) {
            alert('名称不能为空！');
            return;
        }
        // 【核心修改】从 textarea 直接获取值
        const content = document.getElementById('preset-content-text').value.trim();
        const selectedAssociations = Array.from(presetDropdownList.querySelectorAll('input:checked')).map(input => input.dataset.id);

        if (currentEditingPresetId) { // 编辑
            const preset = presets.roles.find(p => p.id === currentEditingPresetId);
            if (preset) {
                preset.name = name;
                preset.content = content;
                preset.associations = selectedAssociations;
            }
        } else { // 创建
            presets.roles.push({
                id: 'role_' + Date.now() + Math.random(), name, content, avatar: '',
                associations: selectedAssociations
            });
        }
        savePresets();
        renderRolePresetsPage();
        showScreen('world-book-screen');
    });

    // 【【【核心新增】】】保存预设
    const saveOfflinePresetBtn = document.getElementById('save-offline-preset-btn');
    saveOfflinePresetBtn.addEventListener('click', () => {
        const name = document.getElementById('preset-offline-name-text').textContent.trim();
        if (!name) { alert('名称不能为空！'); return; }

        const presetData = {
            name: name,
            // 【核心修改】从 textarea 直接获取值
            prompt: document.getElementById('preset-offline-content-text').value.trim(),
            mode: document.getElementById('preset-offline-mode-select').value,
            role: document.getElementById('preset-offline-role-select').value,
            position: document.getElementById('preset-offline-position-select').value,
            enabled: true // 新建或保存时默认开启
        };

        if (currentEditingOfflinePresetId) { // 编辑
            const index = presets.offlines.findIndex(p => p.id === currentEditingOfflinePresetId);
            if (index > -1) {
                presets.offlines[index] = { ...presets.offlines[index], ...presetData };
            }
        } else { // 创建
            presets.offlines.push({ id: 'offline_' + Date.now() + Math.random(), ...presetData });
        }
        savePresets();
        renderOfflinePresetsPage();
        showScreen('world-book-screen');
    });

    saveForbiddenWordsBtn.addEventListener('click', () => {
        presets.forbiddenWords.position = forbiddenWordsPositionSelect.value;
        presets.forbiddenWords.content = forbiddenWordsContentInput.value.trim();
        savePresets();
        alert('禁词已保存！');
        showScreen('world-book-screen');
    });

    // --- 编辑器内的交互 ---
    presetNameContainer.addEventListener('click', () => presetEditInPlace(presetNameContainer, presetNameText, false));
    // 【核心删除】移除对内容框的旧版原地编辑绑定
    // presetContentContainer.addEventListener('click', () => presetEditInPlace(presetContentContainer, presetContentText, true));

    // 【核心删除】移除对预设编辑器的旧版原地编辑绑定
    document.getElementById('preset-offline-name-container').addEventListener('click', (e) => presetEditInPlace(e.currentTarget, document.getElementById('preset-offline-name-text'), false));
    // document.getElementById('preset-offline-content-container').addEventListener('click', (e) => presetEditInPlace(e.currentTarget, document.getElementById('preset-offline-content-text'), true));

    presetDropdownHeader.addEventListener('click', () => {
        presetDropdownContainer.classList.toggle('expanded');
    });
    presetDropdownList.addEventListener('change', () => {
        const count = presetDropdownList.querySelectorAll('input:checked').length;
        updateDropdownLabel(count);
    });

    /**
* 【【【全新安全网】】】一个更强大的、能容错的AI JSON响应解析器
* @param {string} jsonString - AI返回的、可能不完整的JSON字符串
* @returns {Array} - 一个标准化的消息对象数组
*/
    function parseAiJsonResponse(jsonString) {
        let text = jsonString.trim();

        // 策略1: 优先清理最常见的污染
        text = text.replace(/^```json\s*/, '').replace(/```$/, '').trim();

        // 策略2: 尝试直接解析
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            // 如果直接解析失败，启动救援策略
        }

        // 策略3: 救援 - 提取所有独立的 {} JSON对象
        // 这个正则表达式可以从混乱的文本中，像钓鱼一样把所有完整的JSON对象钓出来
        const jsonObjects = text.match(/{[^{}]*:[^}]*}/g);
        if (jsonObjects) {
            const results = [];
            jsonObjects.forEach(objStr => {
                try {
                    results.push(JSON.parse(objStr));
                } catch (e) {
                    console.warn('跳过一个无法解析的JSON片段:', objStr);
                }
            });
            if (results.length > 0) {
                console.log(`JSON救援成功, 提取到 ${results.length} 个对象。`);
                return results;
            }
        }

        // 策略4: 最后的防线 - 将整个回复视为单条纯文本消息
        console.error("所有JSON解析策略均失败！将回复视为纯文本。原始回复:", jsonString);
        return [{ type: 'text', content: jsonString }];
    }


    // ===================================================================
    // 【全新】个性装扮与主题切换核心功能函数
    // ===================================================================

    /**
     * 渲染“个性装扮”页面
     */
    function renderAppearanceStyleScreen() {
        const currentTheme = themes.find(t => t.id === currentThemeId);
        if (!currentTheme) return;

        const iconWrapper = document.querySelector('#current-theme-item .appearance-item-icon-wrapper');
        const titleSpan = document.querySelector('#current-theme-item .appearance-item-title');

        titleSpan.textContent = currentTheme.name;

        // --- 动态创建主题封面图标 ---
        let iconStyle = '';
        if (currentTheme.iconGradient) {
            iconStyle = `background: ${currentTheme.iconGradient};`;
        } else {
            // 【核心修复】在这里添加了和“更换主题”页面一样的描边判断逻辑
            const borderStyle = (currentTheme.iconBg === '#ffffff') ? 'border: 1.7px solid #f0f0f0;' : '';
            iconStyle = `background-color: ${currentTheme.iconBg}; ${borderStyle}`;
        }

        // 动态生成包含SVG的HTML，并应用计算出的样式
        iconWrapper.innerHTML = `
                    <div class="theme-item-icon-wrapper" style="${iconStyle}">
                        <svg t="1759739878868" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="159129" width="25" height="25">
                            <path d="M944.12 345.193333c-23.773333-50.853333-57.76-96.486667-101.026667-135.626666-43.093333-39-93.266667-69.606667-149.093333-90.973334C636.333333 96.526667 575.093333 85.333333 512 85.333333s-124.333333 11.193333-182 33.26c-55.82 21.366667-106 52-149.093333 90.973334-43.26 39.14-77.246667 84.773333-101.02 135.626666A391.093333 391.093333 0 0 0 42.666667 512c0 119.68 54.806667 232.9 151.1 313.64-30.666667 40.166667-74.926667 76.58-140.74 116.066667A21.333333 21.333333 0 0 0 64 981.333333c64.953333 0 124.666667-6.46 177.486667-19.206666 45.026667-10.86 85.226667-26.313333 119.68-46A511.086667 511.086667 0 0 0 512 938.666667c63.093333 0 124.333333-11.193333 182-33.26 55.82-21.333333 106-52 149.086667-90.973334 43.266667-39.14 77.253333-84.773333 101.026666-135.626666a392.46 392.46 0 0 0 0-333.613334z" fill="${currentTheme.iconFill}" p-id="159130"></path>
                        </svg>
                    </div>
                `;
    }

    /**
     * 渲染“更换主题”页面
     */
    function renderThemeChangeScreen() {
        const currentThemeWrapper = document.getElementById('current-theme-display-wrapper');
        const otherThemesWrapper = document.getElementById('other-themes-list-wrapper');

        currentThemeWrapper.innerHTML = '';
        otherThemesWrapper.innerHTML = '';

        themes.forEach(theme => {
            let iconStyle = '';
            if (theme.iconGradient) {
                iconStyle = `background: ${theme.iconGradient};`;
            } else {
                // 为白色背景的主题添加一个细边框以示区分
                const borderStyle = (theme.iconBg === '#ffffff') ? 'border: 1.7px solid #f0f0f0;' : '';
                iconStyle = `background-color: ${theme.iconBg}; ${borderStyle}`;
            }

            const themeItemHTML = `
                        <div class="theme-item" data-theme-id="${theme.id}">
                            <div class="theme-item-icon-wrapper" style="${iconStyle}">
                                <svg t="1759739878868" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="159129" width="25" height="25">
                                    <path d="M944.12 345.193333c-23.773333-50.853333-57.76-96.486667-101.026667-135.626666-43.093333-39-93.266667-69.606667-149.093333-90.973334C636.333333 96.526667 575.093333 85.333333 512 85.333333s-124.333333 11.193333-182 33.26c-55.82 21.366667-106 52-149.093333 90.973334-43.26 39.14-77.246667 84.773333-101.02 135.626666A391.093333 391.093333 0 0 0 42.666667 512c0 119.68 54.806667 232.9 151.1 313.64-30.666667 40.166667-74.926667 76.58-140.74 116.066667A21.333333 21.333333 0 0 0 64 981.333333c64.953333 0 124.666667-6.46 177.486667-19.206666 45.026667-10.86 85.226667-26.313333 119.68-46A511.086667 511.086667 0 0 0 512 938.666667c63.093333 0 124.333333-11.193333 182-33.26 55.82-21.333333 106-52 149.086667-90.973334 43.266667-39.14 77.253333-84.773333 101.026666-135.626666a392.46 392.46 0 0 0 0-333.613334z" fill="${theme.iconFill}" p-id="159130"></path>
                                </svg>
                            </div>
                            <span class="theme-item-title">${theme.name}</span>
                        </div>
                    `;

            if (theme.id === currentThemeId) {
                currentThemeWrapper.innerHTML = themeItemHTML;
            } else {
                otherThemesWrapper.innerHTML += themeItemHTML;
            }
        });

        // 为“其他主题”列表中的每一项添加点击事件
        otherThemesWrapper.querySelectorAll('.theme-item').forEach(item => {
            item.addEventListener('click', async () => { // 将函数改为 async
                const themeId = item.dataset.themeId;
                await applyTheme(themeId); // 等待主题应用完成
                // 选择后，返回到“个性装扮”页面，并刷新该页面的显示
                renderAppearanceStyleScreen();
                showScreen('appearance-style-screen');
            });
        });
    }

    /**
     * 应用主题
     * @param {string} themeId - 要应用的主题ID
     */
    async function applyTheme(themeId) {
        const theme = themes.find(t => t.id === themeId);
        if (!theme) return;

        currentThemeId = themeId;
        await db.set('currentTheme', themeId); // 保存用户的选择

        // 移除所有可能存在的主题类名
        themes.forEach(t => {
            if (t.className) document.body.classList.remove(t.className);
        });

        // 如果新主题有关联的类名，则添加它
        if (theme.className) {
            document.body.classList.add(theme.className);
        }

        // 【【【新增】】】根据主题动态修改输入框的提示文字
        const messageInput = document.getElementById('message-input');
        if (messageInput) {
            if (themeId === 'pop') {
                messageInput.placeholder = "输入消息...";
            } else {
                messageInput.placeholder = "iMessage信息";
            }
        }
    }

    /**
     * 加载并应用已保存的主题
     */
    async function loadAndApplyTheme() {
        const savedThemeId = await db.get('currentTheme');
        if (savedThemeId && themes.find(t => t.id === savedThemeId)) {
            await applyTheme(savedThemeId);
        } else {
            await applyTheme('imessage-day'); // 如果没有保存的或无效的，则应用默认主题
        }
    }
    /**
     * 【【【全新】】】控制“在线/正在输入”状态切换的动画函数
     * @param {boolean} showTyping - true 表示显示“正在输入”，false 表示显示“在线”
     */
    function animateStatusText(showTyping) {
        const onlineEl = document.getElementById('chat-contact-status-online');
        const typingEl = document.getElementById('chat-contact-status-typing');
        if (!onlineEl || !typingEl) return;

        const elToShow = showTyping ? typingEl : onlineEl;
        const elToHide = showTyping ? onlineEl : typingEl;

        // 如果状态已经是正确的，则不执行任何操作，防止动画重叠
        if (elToShow.classList.contains('active')) {
            return;
        }

        // 移除可能残留的旧动画类
        elToHide.classList.remove('anim-in', 'anim-out');
        elToShow.classList.remove('anim-in', 'anim-out');

        // 强制浏览器重绘，确保移除类名的操作生效
        void elToHide.offsetWidth;
        void elToShow.offsetWidth;

        // 为要隐藏的元素添加“向下淡出”动画
        elToHide.classList.add('anim-out');

        // 为要显示的元素添加“从上往下淡入”动画
        elToShow.classList.add('anim-in');

        // 切换激活状态
        elToHide.classList.remove('active');
        elToShow.classList.add('active');

        // 监听旧元素的动画结束事件，结束后将其彻底隐藏
        elToHide.addEventListener('animationend', () => {
            elToHide.classList.remove('anim-out');
        }, { once: true });

        // 监听新元素的动画结束事件，结束后移除动画类，保持最终状态
        elToShow.addEventListener('animationend', () => {
            elToShow.classList.remove('anim-in');
        }, { once: true });
    }

    // --- 初始化 (V1.92 最终性能优化版) ---
    async function initializeApp() {
        // 【第一步：缓存】在所有操作开始前，一次性查找并缓存所有图标元素及其默认SVG
        const iconConfig = [
            { key: 'chat', elements: document.querySelectorAll('.new-app-icon[data-target="chat-list-screen"], .app-icon-preview[data-icon-key="chat"]') },
            { key: 'forum', elements: document.querySelectorAll('#main-apps-container .new-app-icon:nth-child(2), .app-icon-preview[data-icon-key="forum"]') },
            { key: 'worldbook', elements: document.querySelectorAll('.new-app-icon[data-target="world-book-screen"], .app-icon-preview[data-icon-key="worldbook"]') },
            { key: 'couple', elements: document.querySelectorAll('#main-apps-container .new-app-icon:nth-child(4), .app-icon-preview[data-icon-key="couple"]') },
            { key: 'settings', elements: document.querySelectorAll('.new-app-icon[data-target="main-settings-screen"], .app-icon-preview[data-icon-key="settings"]') },
            { key: 'camera', elements: document.querySelectorAll('#bottom-dock .new-app-icon:nth-child(2), .app-icon-preview[data-icon-key="camera"]') },
            { key: 'message', elements: document.querySelectorAll('#bottom-dock .new-app-icon:nth-child(3), .app-icon-preview[data-icon-key="message"]') },
            { key: 'phone', elements: document.querySelectorAll('#bottom-dock .new-app-icon:nth-child(4), .app-icon-preview[data-icon-key="phone"]') },
        ];

        iconConfig.forEach(config => {
            // 将查找到的元素列表存入我们的“地图”
            iconConfigMap[config.key] = config.elements;
            // 同时，从第一个找到的元素中备份默认SVG
            if (config.elements.length > 0 && config.elements[0]) {
                defaultIconSVGs[config.key] = config.elements[0].innerHTML;
            }
        });

        // 【第二步：加载数据】使用 await 确保每个加载函数都执行完毕后，再进行下一步
        await loadSettings();
        await loadChats();
        await loadStickers();
        await loadDesktopSettings();
        await loadCoupleSpaceSettings();
        await loadFontSettings();
        await loadPresets(); // 【新增】加载世界书数据
        await loadPhoneFrameSetting();
        await loadAndApplyTheme(); // 【【【新增】】】加载并应用保存的主题
        await loadMePageData(); // 【【【全新】】】 加载“Me”页面的数据
        await loadLockScreenSettings(); // 【【【新增】】】 加载锁屏数据
        applyMePageData(); // 【【【全新】】】 将加载的数据应用到UI上

        // --- 【【【全新】】】为插入弹窗绑定事件 ---
        insertActionsContainer.addEventListener('click', (e) => {
            const actionBtn = e.target.closest('.insert-action-btn');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                if (action === 'add-above') {
                    addNewMessageInModal('above');
                } else if (action === 'add-below') {
                    addNewMessageInModal('below');
                }
            }
        });

        insertPreviewContainer.addEventListener('click', (e) => {
            const deleteBtn = e.target.closest('.insert-delete-btn');
            if (deleteBtn) {
                const itemWrapper = deleteBtn.closest('.insert-preview-item');
                const tempId = itemWrapper.dataset.tempId;
                insertMode.tempMessages = insertMode.tempMessages.filter(m => m.id !== tempId);
                renderInsertPreview();
            }
        });

        insertModalSaveBtn.addEventListener('click', saveInsertedMessages);
        insertModalCancelBtn.addEventListener('click', closeInsertModal);
        insertModalCloseBtn.addEventListener('click', closeInsertModal);

        // --- 【【【全新】】】为多选顶栏按钮绑定事件 ---
        document.getElementById('multi-select-cancel-btn').addEventListener('click', exitMultiSelectMode);
        document.getElementById('multi-select-delete-btn').addEventListener('click', deleteSelectedMessages);

        // 【第三步：渲染界面】现在所有数据都已加载，所有元素都已缓存，可以安全地进行界面渲染了
        applyGlobalFontStyles();
        await loadAndApplyCoupleTheme(); // 这个函数现在也应该是 async 的
        applyDesktopSettings();        // 这个函数会调用 applyDesktopIconSettings
        applyLockScreenSettings();     // 【【【新增】】】 应用锁屏设置
        updateTotalUnreadBadge(); // 【【【核心新增】】】 初始化时就计算并显示总未读数
        renderStatusFeed(); // 【【【全新】】】 初始化时渲染动态列表

        // 【第四步：启动】所有界面都渲染完毕，最后再显示屏幕和启动定时器
        updateTime();
        setInterval(updateTime, 1000);

        // ===================================================================
        // 【【【全新】】】转账功能事件监听
        // ===================================================================
        if (transferBtn) {
            transferBtn.addEventListener('click', openTransferModal);
        }
        if (transferConfirmBtn) {
            transferConfirmBtn.addEventListener('click', handleSendTransfer);
        }
        if (transferCancelBtn) {
            transferCancelBtn.addEventListener('click', () => transferModal.classList.remove('visible'));
        }
        if (transferCloseBtn) {
            transferCloseBtn.addEventListener('click', () => transferModal.classList.remove('visible'));
        }

        // ===================================================================
        // 【【【全新 V5.2】】】拍摄照片功能事件监听
        // ===================================================================

        // 点击“拍摄”图标，打开弹窗
        if (photoDescriptionBtn) {
            photoDescriptionBtn.addEventListener('click', () => {
                // 打开前清空输入框
                photoDescriptionInput.value = '';
                closeAllPanels(); // 关闭可能打开的功能面板
                photoDescriptionModal.classList.add('visible');
            });
        }

        // 点击弹窗内的“发送”按钮
        if (photoDescriptionConfirmBtn) {
            photoDescriptionConfirmBtn.addEventListener('click', () => {
                const description = photoDescriptionInput.value.trim();
                const chat = chats.find(c => c.id === activeChatId);
                if (!description) {
                    alert('照片描述不能为空！');
                    return;
                }
                if (chat) {
                    const message = {
                        role: 'user',
                        content: description,
                        type: 'photo', // 标记为照片类型
                        timestamp: Date.now(),
                        id: 'msg_' + Date.now() + Math.random()
                    };
                    chat.history.push(message);
                    saveChats();
                    appendMessage(message, messageContainer, true);
                    renderContactList();
                    photoDescriptionModal.classList.remove('visible');
                }
            });
        }

        // 为取消和关闭按钮添加关闭弹窗的事件
        if (photoDescriptionCancelBtn) {
            photoDescriptionCancelBtn.addEventListener('click', () => photoDescriptionModal.classList.remove('visible'));
        }
        if (photoDescriptionCloseBtn) {
            photoDescriptionCloseBtn.addEventListener('click', () => photoDescriptionModal.classList.remove('visible'));
        }
        // ===================================================================
        // 【【【全新 V5.2】】】为发送真实照片功能绑定事件
        // ===================================================================
        // 1. 点击“照片”图标，触发隐藏的文件选择器
        if (photoUploadBtn) {
            photoUploadBtn.addEventListener('click', () => {
                closeAllPanels(); // 首先关闭功能面板
                photoUploadInput.click(); // 然后触发文件选择
            });
        }

        // 2. 监听文件选择器的变化，处理图片上传
        if (photoUploadInput) {
            photoUploadInput.addEventListener('change', (event) => {
                const file = event.target.files[0];
                const chat = chats.find(c => c.id === activeChatId);
                if (!file || !chat) return;

                const reader = new FileReader();
                reader.onload = (e) => {
                    const base64Url = e.target.result;

                    // 【关键】创建符合AI识图标准的特殊消息对象
                    const message = {
                        id: 'msg_' + Date.now() + Math.random(),
                        role: 'user',
                        // content不再是字符串，而是一个数组
                        content: [
                            {
                                type: 'image_url',
                                image_url: { "url": base64Url }
                            }
                        ],
                        timestamp: Date.now()
                    };

                    chat.history.push(message);
                    saveChats();
                    appendMessage(message, messageContainer, true);
                    renderContactList();
                };
                reader.readAsDataURL(file);
                event.target.value = null; // 清空以便下次上传同一张图片
            });
        }
        // 【【【全新】】】为语音转文字功能绑定事件
        if (voiceToTextBtn) {
            voiceToTextBtn.addEventListener('click', () => {
                // 打开前清空输入框并关闭其他面板
                voiceContentInput.value = '';
                closeAllPanels();
                voiceToTextModal.classList.add('visible');
            });
        }
        if (voiceToTextConfirmBtn) {
            voiceToTextConfirmBtn.addEventListener('click', handleSendVoiceMessage);
        }
        if (voiceToTextCancelBtn) {
            voiceToTextCancelBtn.addEventListener('click', () => voiceToTextModal.classList.remove('visible'));
        }
        if (voiceToTextCloseBtn) {
            voiceToTextCloseBtn.addEventListener('click', () => voiceToTextModal.classList.remove('visible'));
        }

        // 【【【核心修改】】】 初始时显示锁屏，而不是桌面
        document.getElementById('home-screen').classList.remove('active');
        document.getElementById('lock-screen').classList.add('active');

        // 【【【新增】】】确保桌面在初始时透明度为0，且拥有 active 类，以便在后台准备就绪
        // 【BUG修复】不再手动添加 active 类，交由 showScreen 和解锁逻辑管理
        const homeScreen = document.getElementById('home-screen');
        homeScreen.style.opacity = '0';


        updateLockScreenTimeAndDate(); // 立即更新一次锁屏时间
        setInterval(updateLockScreenTimeAndDate, 1000); // 每秒更新

        // 【【【新增】】】初始化推送通知功能
        initPushNotifications();

        // 【【【新增】】】监听来自 Service Worker 的消息
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', event => {
                if (event.data && event.data.type === 'OPEN_CHAT') {
                    const chatIdToOpen = event.data.chatId;
                    console.log('收到来自 Service Worker 的指令，打开聊天:', chatIdToOpen);

                    // 确保应用已完全加载
                    // 如果 chats 数组已经加载，就直接打开
                    if (window.chats && window.chats.length > 0) {
                        openChat(chatIdToOpen);
                    } else {
                        // 如果应用还没完全初始化好，就先记下来，等初始化完再打开
                        document.addEventListener('appInitialized', () => {
                            openChat(chatIdToOpen);
                        }, { once: true });
                    }
                }
            });
        }


    }

    // ===================================================================
    // 【【【全新功能4：重新生成功能事件监听】】】
    // ===================================================================
    const regenerateModal = document.getElementById('regenerate-modal');
    const regenerateBtn = document.getElementById('func-btn-regenerate');
    const regenerateConfirmBtn = document.getElementById('regenerate-confirm-btn');
    const regenerateCancelBtn = document.getElementById('regenerate-cancel-btn');
    const regenerateCloseBtn = document.getElementById('regenerate-close-btn');

    // 点击“重回”图标，打开弹窗
    if (regenerateBtn) {
        regenerateBtn.addEventListener('click', () => {
            // 打开前清空输入框
            document.getElementById('regenerate-prompt-input').value = '';
            regenerateModal.classList.add('visible');
        });
    }

    // 点击弹窗内的“确认”按钮
    if (regenerateConfirmBtn) {
        regenerateConfirmBtn.addEventListener('click', handleRegenerate);
    }

    // 为取消和关闭按钮添加关闭弹窗的事件
    if (regenerateCancelBtn) {
        regenerateCancelBtn.addEventListener('click', () => regenerateModal.classList.remove('visible'));
    }
    if (regenerateCloseBtn) {
        regenerateCloseBtn.addEventListener('click', () => regenerateModal.classList.remove('visible'));
    }

    // ===================================================================
    // 【全新】个性装扮与主题切换功能事件监听 (修正版)
    // ===================================================================
    const gotoAppearanceStyleBtn = document.getElementById('goto-appearance-style-btn');
    const currentThemeItem = document.getElementById('current-theme-item');
    const backFromAppearanceStyleBtn = document.getElementById('back-from-appearance-style-btn');

    // 从"Me"页面跳转到"个性装扮"页面
    if (gotoAppearanceStyleBtn) {
        gotoAppearanceStyleBtn.addEventListener('click', () => {
            renderAppearanceStyleScreen();
            showScreen('appearance-style-screen');
        });
    }

    // 从"个性装扮"页面跳转到"更换主题"页面
    if (currentThemeItem) {
        currentThemeItem.addEventListener('click', () => {
            renderThemeChangeScreen();
            showScreen('theme-change-screen');
        });
    }

    // 【关键修正】为“个性装扮”页面的返回按钮添加专属返回逻辑
    if (backFromAppearanceStyleBtn) {
        backFromAppearanceStyleBtn.addEventListener('click', () => {
            // 1. 找到并模拟点击底部导航的 "Me" 按钮
            const meNavItem = document.querySelector('.nav-item[data-page="me"]');
            if (meNavItem) {
                meNavItem.click(); // 这会触发现有的导航栏逻辑，自动切换到Me页面
            }
            // 2. 显示包含 "Me" 页面的 chat-list-screen
            showScreen('chat-list-screen');
        });
    }

    // 加载已保存的主题
    loadAndApplyTheme();

    // ===================================================================
    // 【【【全新功能4：重新生成功能核心逻辑】】】
    // ===================================================================

    /**
     * 处理重新生成请求
     */
    async function handleRegenerate() {
        const chat = chats.find(c => c.id === activeChatId);
        if (!chat) return;

        const regeneratePrompt = document.getElementById('regenerate-prompt-input').value.trim();

        // 找到AI的最后一轮回复并删除
        // 1. 从后往前找，找到最后一个 role 为 'user' 的消息
        const lastUserMessageIndex = chat.history.map(m => m.role).lastIndexOf('user');

        // 2. 如果找到了，并且它不是最后一条消息，说明它后面有AI的回复
        if (lastUserMessageIndex > -1 && lastUserMessageIndex < chat.history.length - 1) {
            // 3. 删除从这条用户消息之后的所有消息
            chat.history.splice(lastUserMessageIndex + 1);
        } else if (lastUserMessageIndex === -1 && chat.history.length > 0) {
            // 特殊情况：如果整个历史记录里都没有用户消息（全是AI发的），则全部清空
            chat.history = [];
        }

        await saveChats();
        renderMessages(); // 刷新界面，让用户看到消息被删除
        renderContactList(); // 【【【全新 V5.9 核心修复】】】同步刷新联系人列表

        // 关闭弹窗
        document.getElementById('regenerate-modal').classList.remove('visible');

        // 带上新要求，调用生成函数
        handleGenerateReply(regeneratePrompt);
    }

    /**
     * 【【【全新】】】处理发送语音消息的核心逻辑
     */
    function handleSendVoiceMessage() {
        const text = voiceContentInput.value.trim();
        const chat = chats.find(c => c.id === activeChatId);
        if (!text || !chat) {
            if (!text) alert('语音内容不能为空！');
            return;
        }

        // 根据文字长度计算秒数（每4个字符算1秒，最少1秒，最多60秒）
        const duration = Math.max(1, Math.min(60, Math.ceil(text.length / 4)));

        // 准备要显示在气泡里的HTML内容
        const displayContentHTML = `
                    <span class="voice-duration">${duration}"</span>
                    <span class="voice-icon">
                        <svg t="1759890637480" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="17296" width="19" height="19"><path d="M337.066667 505.6c0-115.2 46.933333-221.866667 121.6-298.666667l-59.733334-59.733333c-76.8 78.933333-130.133333 183.466667-142.933333 298.666667-2.133333 19.2-4.266667 38.4-4.266667 59.733333s2.133333 40.533333 4.266667 59.733333c14.933333 121.6 70.4 230.4 155.733333 311.466667l61.866667-59.733333c-85.333333-78.933333-136.533333-187.733333-136.533333-311.466667z" fill="#353333" p-id="17297"></path><path d="M529.066667 505.6c0-61.866667 25.6-119.466667 66.133333-162.133333L533.333333 283.733333c-55.466667 57.6-89.6 136.533333-89.6 221.866667 0 93.866667 40.533333 179.2 104.533334 236.8l61.866666-59.733333c-51.2-42.666667-81.066667-106.666667-81.066666-177.066667zM667.733333 418.133333c-21.333333 23.466667-34.133333 53.333333-34.133333 87.466667 0 42.666667 21.333333 78.933333 51.2 102.4l87.466667-85.333333-104.533334-104.533334z" fill="#353333" p-id="17298"></path></svg>
                    </span>
                `;

        // 创建消息对象
        const message = {
            id: 'msg_' + Date.now() + Math.random(),
            role: 'user',
            content: text, // 原始文本内容，用于AI理解上下文
            displayContent: displayContentHTML, // 用于显示的HTML
            duration: duration, // 【【【新增】】】保存秒数
            type: 'voice',
            timestamp: Date.now()
        };

        chat.history.push(message);
        saveChats();
        appendMessage(message, messageContainer, true); // 发送并滚动
        renderContactList();

        // 关闭弹窗
        voiceToTextModal.classList.remove('visible');
    }


    // ===================================================================
    // 【【【全新】】】发布动态与渲染核心功能
    // ===================================================================

    /**
     * 渲染整个动态消息流
     */
    function renderStatusFeed() {
        const feedContainer = document.getElementById('couple-status-feed');
        if (!feedContainer) return;

        feedContainer.innerHTML = ''; // 清空
        const statuses = coupleSpaceSettings.statuses || [];

        // 从最新到最旧渲染
        [...statuses].reverse().forEach(status => {
            const postCard = document.createElement('div');
            postCard.className = 'status-post-card';

            // 格式化时间
            const date = new Date(status.timestamp);
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const formattedTime = `${month}-${day} ${hours}:${minutes}`;

            postCard.innerHTML = `
                        <div class="status-post-header">
                            <img src="${status.avatar}" class="status-post-avatar">
                            <div class="status-post-user-info">
                                <p class="status-post-username">${status.name}</p >
                                <span class="status-post-timestamp">${formattedTime}</span>
                            </div>
                        </div>
                        <p class="status-post-content">${status.content}</p >
                        <div class="status-post-actions">
                            <div class="like-btn-wrapper ${status.isLiked ? 'liked' : ''}" data-status-id="${status.id}">
                                <svg class="heart-outline" t="1758886757594" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7994" width="18" height="18"><path d="M667.786667 117.333333C832.864 117.333333 938.666667 249.706667 938.666667 427.861333c0 138.250667-125.098667 290.506667-371.573334 461.589334a96.768 96.768 0 0 1-110.186666 0C210.432 718.368 85.333333 566.112 85.333333 427.861333 85.333333 249.706667 191.136 117.333333 356.213333 117.333333c59.616 0 100.053333 20.832 155.786667 68.096C567.744 138.176 608.170667 117.333333 667.786667 117.333333z m0 63.146667c-41.44 0-70.261333 15.189333-116.96 55.04-2.165333 1.845333-14.4 12.373333-17.941334 15.381333a32.32 32.32 0 0 1-41.770666 0c-3.541333-3.018667-15.776-13.536-17.941334-15.381333-46.698667-39.850667-75.52-55.04-116.96-55.04C230.186667 180.48 149.333333 281.258667 149.333333 426.698667 149.333333 537.6 262.858667 675.242667 493.632 834.826667a32.352 32.352 0 0 0 36.736 0C761.141333 675.253333 874.666667 537.6 874.666667 426.698667c0-145.44-80.853333-246.218667-206.88-246.218667z" fill="#ffe5a5" p-id="7995"></path></svg>
                                <svg class="heart-filled" t="1758886770876" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="8300" width="18" height="18"><path d="M667.786667 117.333333C832.864 117.333333 938.666667 249.706667 938.666667 427.861333c0 138.250667-125.098667 290.506667-371.573334 461.589334a96.768 96.768 0 0 1-110.186666 0C210.432 718.368 85.333333 566.112 85.333333 427.861333 85.333333 249.706667 191.136 117.333333 356.213333 117.333333c59.616 0 100.053333 20.832 155.786667 68.096C567.744 138.176 608.170667 117.333333 667.786667 117.333333z" fill="#ffe5a5" p-id="8301"></path></svg>
                            </div>
                            <div class="delete-status-btn" data-status-id="${status.id}">
                                <svg t="1758793185605" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="11305" width="17" height="17"><path d="M377.6 153.6h268.8c22.4 0 44.8-17.9 44.8-44.8 0-22.4-17.9-44.8-44.8-44.8H377.6c-22.4 0-44.8 17.9-44.8 44.8 0 22.4 17.9 44.8 44.8 44.8z m537.6 35.8H108.8c-22.4 0-44.8 17.9-44.8 44.8 0 22.4 17.9 44.8 44.8 44.8h53.8v555.5c0 67.2 58.2 125.4 125.4 125.4h448c67.2 0 125.4-58.2 125.4-125.4V279h53.8c22.4 0 44.8-17.9 44.8-44.8 0 22.4-17.9-44.8-44.8-44.8zM789.8 834.6c0 31.4-22.4 53.8-53.8 53.8H288c-31.4 0-53.8-22.4-53.8-53.8V279h555.5v555.6z m-398.6-63.2c22.1 0 44.2-18.9 44.2-47.2V441.3c0-23.6-17.7-47.2-44.2-47.2-22.1 0-44.2 18.9-44.2 47.2v282.9c-0.1 23.6 17.6 47.2 44.2 47.2z m194.5 0c22.1 0 44.2-18.9 44.2-47.2V441.3c0-23.6-17.7-47.2-44.2-47.2-22.1 0-44.2 18.9-44.2 47.2v282.9c0 23.6 22.1 47.2 44.2 47.2z" fill="#ffe5a5" p-id="11306"></path></svg>
                            </div>
                        </div>
                        
                        <!-- 【核心新增】评论区容器 -->
                        <div class="status-post-comments-list">
                            ${(status.comments && status.comments.length > 0) ? status.comments.map(comment => `
                                <div class="comment-item">
                                    <span class="comment-content">
                                        <span class="commenter-name">${comment.commenterName}：</span>${comment.content}
                                    </span>
                                    <div class="comment-delete-btn" data-status-id="${status.id}" data-comment-id="${comment.id}">
                                        <svg t="1758793185605" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="11305" width="17" height="17"><path d="M377.6 153.6h268.8c22.4 0 44.8-17.9 44.8-44.8 0-22.4-17.9-44.8-44.8-44.8H377.6c-22.4 0-44.8 17.9-44.8 44.8 0 22.4 17.9 44.8 44.8 44.8z m537.6 35.8H108.8c-22.4 0-44.8 17.9-44.8 44.8 0 22.4 17.9 44.8 44.8 44.8h53.8v555.5c0 67.2 58.2 125.4 125.4 125.4h448c67.2 0 125.4-58.2 125.4-125.4V279h53.8c22.4 0 44.8-17.9 44.8-44.8 0 22.4-17.9-44.8-44.8-44.8zM789.8 834.6c0 31.4-22.4 53.8-53.8 53.8H288c-31.4 0-53.8-22.4-53.8-53.8V279h555.5v555.6z m-398.6-63.2c22.1 0 44.2-18.9 44.2-47.2V441.3c0-23.6-17.7-47.2-44.2-47.2-22.1 0-44.2 18.9-44.2 47.2v282.9c-0.1 23.6 17.6 47.2 44.2 47.2z m194.5 0c22.1 0 44.2-18.9 44.2-47.2V441.3c0-23.6-17.7-47.2-44.2-47.2-22.1 0-44.2 18.9-44.2 47.2v282.9c0 23.6 22.1 47.2 44.2 47.2z" fill="#ffe5a5" p-id="11306"></path></svg>
                                    </div>
                                </div>
                            `).join('') : ''}
                        </div>

                        <div class="status-post-divider"></div>
                        <div class="status-post-comment-area" data-status-id="${status.id}">
                            <img src="${coupleSpaceSettings.myAvatar || 'https://tc.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250911/GcRW/1206X1185/IMG_7210.jpeg/webp'}" class="status-post-comment-avatar">
                            <input type="text" class="status-post-comment-input" placeholder="说点什么吧...">
                            <span class="status-post-comment-send">发送</span>
                        </div>
                    `;
            feedContainer.appendChild(postCard);
            // 【【【全新 V3.8】】】为动态卡片添加点赞事件监听
            const likeBtn = postCard.querySelector('.like-btn-wrapper');
            if (likeBtn) {
                likeBtn.addEventListener('click', () => {
                    const statusId = likeBtn.dataset.statusId;
                    const statusToUpdate = coupleSpaceSettings.statuses.find(s => s.id === statusId);

                    if (statusToUpdate) {
                        // 切换点赞状态
                        statusToUpdate.isLiked = !statusToUpdate.isLiked;

                        // 立即更新UI，触发动画
                        likeBtn.classList.toggle('liked');

                        // 保存更改
                        saveCoupleSpaceSettings();
                    }
                });
            }
            // 【【【全新 V3.8.1】】】为动态卡片添加删除事件监听
            const deleteBtn = postCard.querySelector('.delete-status-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                    const statusId = deleteBtn.dataset.statusId;

                    // 调用通用的确认弹窗
                    showConfirmationModal('确定要删除这条动态吗？此操作不可撤销。', () => {
                        // 查找要删除的动态在数组中的索引
                        const indexToDelete = coupleSpaceSettings.statuses.findIndex(s => s.id === statusId);

                        if (indexToDelete > -1) {
                            // 从数组中移除该动态
                            coupleSpaceSettings.statuses.splice(indexToDelete, 1);

                            // 保存更改
                            saveCoupleSpaceSettings();

                            // 重新渲染动态列表
                            renderStatusFeed();
                        }
                    });
                });
            }
        });
    }



    // ===================================================================
    // 【【【全新】】】发布动态弹窗事件监听
    // ===================================================================
    const statusModalPublishBtn = postStatusModal.querySelector('.status-modal-action-btn.publish');
    const statusModalTextarea = postStatusModal.querySelector('.status-modal-textarea');

    // 点击“发动态”按钮，显示弹窗
    postStatusBtn.addEventListener('click', () => {
        postStatusModal.classList.add('visible');
    });

    // 点击“发布”按钮
    statusModalPublishBtn.addEventListener('click', () => {
        const content = statusModalTextarea.value.trim();
        if (!content) {
            alert('动态内容不能为空哦！');
            return;
        }

        // 找到当前用户的聊天设置来获取名字和头像
        const currentChat = chats.find(c => c.id === coupleSpaceSettings.partnerChatId);
        const userName = currentChat ? (currentChat.settings.userName || '我') : '我';
        const userAvatar = coupleSpaceSettings.myAvatar;

        const newStatus = {
            id: 'status_' + Date.now() + Math.random(), // 【核心修复】确保ID绝对唯一
            content: content,
            timestamp: Date.now(),
            name: userName,
            avatar: userAvatar,
            likes: [],
            isLiked: false,
            comments: [] // 【核心新增】为新动态添加一个空的 comments 数组
        };

        coupleSpaceSettings.statuses.push(newStatus);
        saveCoupleSpaceSettings(); // 保存到数据库
        renderStatusFeed(); // 重新渲染动态列表

        // 清理并关闭弹窗
        statusModalTextarea.value = '';
        postStatusModal.classList.remove('visible');
    });

    // 点击弹窗的“关闭”按钮，隐藏弹窗
    statusModalCloseBtn.addEventListener('click', () => {
        postStatusModal.classList.remove('visible');
    });

    // 点击弹窗的“取消”按钮，隐藏弹窗
    statusModalCancelBtn.addEventListener('click', () => {
        postStatusModal.classList.remove('visible');
    });

    /**
* 【【【全新 V3.9.2】】】 辅助函数：检查两个时间戳是否在同一天
* @param {number} ts1 - 时间戳1
* @param {number} ts2 - 时间戳2
* @returns {boolean}
*/
    function isSameDay(ts1, ts2) {
        const date1 = new Date(ts1);
        const date2 = new Date(ts2);
        return date1.getFullYear() === date2.getFullYear() &&
            date1.getMonth() === date2.getMonth() &&
            date1.getDate() === date2.getDate();
    }

    // ===================================================================
    // 【【【全新 V3.9】】】添加状态弹窗核心功能函数
    // ===================================================================

    /**
     * 打开添加状态弹窗
     */
    function openAddStatusModal() {
        // 1. 重置状态
        currentStatusData = {
            subject: 'user' // 默认是“自己”
        };
        statusSubjectSelector.textContent = '自己';
        statusTimeInput.value = '';
        statusContentInput.value = '';

        // 2. 更新并清空下拉框显示
        const selectedIconDiv = statusDropdownHeader.querySelector('.status-dropdown-selected-icon');
        const selectedTextSpan = statusDropdownHeader.querySelector('.status-dropdown-selected-text');
        selectedIconDiv.innerHTML = '';
        selectedTextSpan.textContent = '';
        statusDropdownContainer.classList.remove('expanded');

        // 3. 动态填充下拉列表
        statusDropdownList.innerHTML = '';
        statusOptions.forEach(option => {
            const item = document.createElement('div');
            item.className = 'status-dropdown-item';
            item.dataset.id = option.id;
            item.innerHTML = `
                        <div class="status-dropdown-item-icon">${option.svg}</div>
                        <span class="status-dropdown-item-text">${option.text}</span>
                    `;
            statusDropdownList.appendChild(item);
        });

        // 4. 显示弹窗
        addStatusModal.classList.add('visible');
    }

    /**
     * 保存新添加的状态消息
     */
    function saveNewStatusMessage() {
        const time = statusTimeInput.value.trim();
        const content = statusContentInput.value.trim();
        const partnerId = coupleSpaceSettings.partnerChatId;
        const partnerChat = chats.find(c => c.id === partnerId);

        // 1. 数据验证
        if (!currentStatusData.id) {
            alert('请先选择一个状态类型！');
            return;
        }
        if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
            alert('请输入有效的24小时制时间，格式为 HH:MM，例如 21:23');
            return;
        }
        if (!content) {
            alert('自定义内容不能为空！');
            return;
        }
        if (!partnerChat) return;

        // 2. 组装新消息对象
        const subjectName = currentStatusData.subject === 'user'
            ? (partnerChat.settings.userName || '我')
            : (partnerChat.settings.aiName || 'TA');

        const newStatusMessage = {
            id: 'sys_status_' + Date.now() + Math.random(), // 确保ID唯一
            type: 'system_status', // 标记为新类型
            timestamp: Date.now(), // 使用当前时间戳用于排序
            customTime: time, // 保存用户输入的时间用于显示
            iconSvg: currentStatusData.svg,
            subjectName: subjectName,
            content: content
        };

        // 3. 保存数据
        if (!coupleStatusMessages[partnerId]) {
            coupleStatusMessages[partnerId] = [];
        }
        coupleStatusMessages[partnerId].push(newStatusMessage);

        // 按照自定义时间进行排序
        coupleStatusMessages[partnerId].sort((a, b) => {
            const timeA = a.customTime ? a.customTime.replace(':', '') : formatMessageTime(a.timestamp).replace(':', '');
            const timeB = b.customTime ? b.customTime.replace(':', '') : formatMessageTime(b.timestamp).replace(':', '');
            return parseInt(timeA) - parseInt(timeB);
        });

        saveCoupleSpaceSettings();

        // 4. 刷新界面并关闭弹窗
        renderStatusMessages(); // 【核心修复】移除 true，使用默认模式刷新
        addStatusModal.classList.remove('visible');

        // 【【【核心新增 V3.9.3】】】添加新状态后，强制滚动到底部
        setTimeout(() => {
            coupleStatusMessageContainer.scrollTop = coupleStatusMessageContainer.scrollHeight;
        }, 50);
    }

    // ===================================================================
    // 【【【全新 V2.62 & V3.9.5】】】情侣空间与状态页事件监听（集成版）
    // ===================================================================

    // 【【【全新 V3.9.5】】】为新的删除模式按钮绑定事件
    statusDirectDeleteBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止事件冒泡到父级
        coupleStatusDetailScreen.classList.toggle('direct-delete-mode');
    });

    // 监听对方头像的点击事件，用于显示/隐藏解绑气泡
    partnerAvatarWrapper.addEventListener('click', (e) => {
        // 如果点击的是气泡内部，则不处理，交由气泡自己的按钮处理
        if (e.target.closest('.breakup-popup')) {
            return;
        }

        // 只有在已绑定状态下才响应
        if (coupleSpaceSettings.partnerChatId) {
            // 【【【核心修改】】】使用 if/else 代替 toggle，以便调用新函数
            if (partnerAvatarWrapper.classList.contains('popup-active')) {
                // 这里我们不需要用新函数，因为它没有 visibility:hidden，CSS过渡本身就能处理好
                partnerAvatarWrapper.classList.remove('popup-active');
            } else {
                partnerAvatarWrapper.classList.add('popup-active');
            }
        }
    });

    // 【【【全新增补】】】点击页面其他地方关闭解除关系小气泡
    document.body.addEventListener('click', (e) => {
        if (partnerAvatarWrapper.classList.contains('popup-active') && !partnerAvatarWrapper.contains(e.target)) {
            partnerAvatarWrapper.classList.remove('popup-active');
        }
    });

    // 监听解绑气泡上的关闭按钮
    breakupCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const partnerChat = chats.find(c => c.id === coupleSpaceSettings.partnerChatId);
        const partnerName = partnerChat ? partnerChat.name : '对方';

        // 【修复问题6】调用通用的确认弹窗
        showConfirmationModal(`确定要与 ${partnerName} 解除关系吗？历史记录将会清空`, () => {
            handleBreakup();
        });
    });

    // 监听消息页面中“状态”消息条的点击事件
    document.querySelector('.couple-message-item[data-target="couple-status-detail-screen"]').addEventListener('click', () => {
        openStatusDetailScreen();
    });

    // 状态详情页输入框交互
    statusInputPlaceholder.addEventListener('click', () => {
        statusInputPlaceholder.style.display = 'none';
        statusInputActiveWrapper.style.display = 'flex';
        statusMessageInput.focus();

        // 【核心动画修复】使用 requestAnimationFrame 确保浏览器先渲染出“小”状态
        // 然后在下一帧添加 'input-active' 类，从而触发撑开动画。
        requestAnimationFrame(() => {
            statusInputActiveWrapper.classList.add('input-active');
        });
    });
    statusMessageInput.addEventListener('blur', () => {
        if (statusMessageInput.value.trim() === '') {
            // 【核心修改】移除激活 class，触发收起动画
            statusInputActiveWrapper.classList.remove('input-active');
            // 使用一个短暂的延迟来等待动画播放完毕
            setTimeout(() => {
                statusInputActiveWrapper.style.display = 'none';
                statusInputPlaceholder.style.display = 'flex';
            }, 300); // 这个时间(300毫秒)要和CSS里的动画时长一致
        }
    });
    statusMessageInput.addEventListener('input', () => {
        statusMessageInput.style.height = 'auto';
        statusMessageInput.style.height = (statusMessageInput.scrollHeight) + 'px';
    });
    statusSendBtn.addEventListener('click', sendStatusMessage);
    statusMessageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendStatusMessage();
        }
    });
    // 【【【全新】】】点击状态详情页的非输入区，自动收起输入框
    coupleStatusDetailScreen.addEventListener('click', (e) => {
        const inputArea = document.getElementById('couple-status-input-area');
        const activeWrapper = document.getElementById('status-input-active-wrapper');

        // 检查：1.输入框当前是否是激活状态 2.点击的目标不是输入框区域本身
        if (inputArea.classList.contains('input-active') && !activeWrapper.contains(e.target)) {
            // 只有当输入框内容为空时，点击外部才收起
            if (statusMessageInput.value.trim() === '') {
                inputArea.classList.remove('input-active');
            }
        }
    });
    // 状态详情页右上角菜单
    coupleStatusOptionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (coupleStatusContextMenu.classList.contains('visible')) {
            hideWithTransition(coupleStatusContextMenu, 'visible');
        } else {
            coupleStatusContextMenu.style.visibility = 'visible';
            coupleStatusContextMenu.classList.add('visible');
        }
    });

    // 【【【新增 V3.9】】】为菜单项添加事件委托
    coupleStatusContextMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.status-menu-item');
        if (!item) return;

        const action = item.dataset.action;

        // 不管点击哪个，都先收起菜单
        hideWithTransition(coupleStatusContextMenu, 'visible');

        switch (action) {
            case 'add-status':
                // 使用一个微小延迟，确保菜单收起动画播放完毕后再打开弹窗
                setTimeout(openAddStatusModal, 200);
                break;
            case 'reply':
                // 这里可以放“回复”功能的代码（如果未来需要）
                break;
            case 'status':
                // 这里可以放“状态”功能的代码（如果未来需要）
                break;
            case 'history':
                // 这里可以放“历史”功能的代码（如果未来需要）
                break;
        }
    });


    // ===================================================================
    // 【【【全新 V2.62】】】情侣空间与状态页事件监听
    // ===================================================================


    // 使用事件委托来处理消息的点击
    coupleStatusMessageContainer.addEventListener('click', (e) => {
        // 【【【核心修改 V3.9.5：增加对新删除图标的判断】】】
        const directDeleteIcon = e.target.closest('.status-direct-delete-icon');

        if (directDeleteIcon) {
            e.stopPropagation(); // 阻止事件冒泡
            const msgId = directDeleteIcon.dataset.messageId;

            const partnerId = coupleSpaceSettings.partnerChatId;
            if (partnerId && coupleStatusMessages[partnerId]) {
                // 过滤掉要删除的消息
                coupleStatusMessages[partnerId] = coupleStatusMessages[partnerId].filter(msg => msg.id !== msgId);

                // 保存更改并立即刷新页面
                saveCoupleSpaceSettings();
                renderStatusMessages(true); // 传入true确保即使删的是历史消息也能正确刷新
            }
            return; // 处理完毕，结束
        }


        const bubble = e.target.closest('.status-message-bubble');
        if (!bubble) return; // 如果点击的不是气泡，则不执行任何操作

        // 【【【核心新增】】】如果气泡正处于编辑状态，则直接返回，不执行任何后续操作
        if (bubble.isEditing) {
            return;
        }

        const wrapper = bubble.closest('.status-message-wrapper');
        const msgId = wrapper.dataset.messageId;

        if (statusMultiSelectMode) {
            toggleStatusSelection(msgId, wrapper);
        } else {
            openStatusContextMenu(bubble, msgId);
        }
    });

    // 监听小卡片上的按钮点击
    statusMessageContextCard.addEventListener('click', (e) => {
        const item = e.target.closest('.status-card-menu-item');
        if (item) {
            const action = item.dataset.action;
            if (action === 'edit') {
                handleStatusEdit();
            } else if (action === 'delete') {
                // 【修改】进入多选模式后，自动选中当前这条消息
                enterStatusMultiSelectMode();
                const wrapper = document.querySelector(`.status-message-wrapper[data-message-id="${activeStatusContextMenuMsgId}"]`);
                if (wrapper) toggleStatusSelection(activeStatusContextMenuMsgId, wrapper);
            }
            statusMessageContextCard.classList.remove('visible'); // 操作后关闭小卡片
        }
    });

    // 点击页面任何地方或滚动时关闭小卡片 和 快捷删除模式
    coupleStatusDetailScreen.addEventListener('click', (e) => {
        // 如果点击的目标不是小卡片本身，也不是消息气泡，就关闭小卡片
        if (statusMessageContextCard.classList.contains('visible') && !statusMessageContextCard.contains(e.target) && !e.target.closest('.status-message-bubble')) {
            hideWithTransition(statusMessageContextCard, 'visible');
        }

        // 【【【核心新增 V3.9.5】】】如果页面处于快捷删除模式，并且点击的不是任何消息或顶栏按钮，则退出模式
        if (coupleStatusDetailScreen.classList.contains('direct-delete-mode') &&
            !e.target.closest('.status-message-wrapper, .system-status-wrapper, .couple-status-header')) {
            coupleStatusDetailScreen.classList.remove('direct-delete-mode');
        }
    });

    // 【新增】滚动时关闭小卡片
    coupleStatusMessageContainer.addEventListener('scroll', () => {
        if (statusMessageContextCard.classList.contains('visible')) {
            // 【【【核心修改】】】使用新函数来隐藏
            hideWithTransition(statusMessageContextCard, 'visible');
        }
    });

    // 监听多选模式顶栏按钮
    statusMultiSelectCancelBtn.addEventListener('click', exitStatusMultiSelectMode);
    statusMultiSelectDeleteBtn.addEventListener('click', deleteSelectedStatusMessages);


    // 点击页面任何其他地方关闭状态页菜单
    document.body.addEventListener('click', (e) => {
        if (coupleStatusContextMenu.classList.contains('visible') && !coupleStatusContextMenu.contains(e.target) && !e.target.closest('#couple-status-options-btn')) {
            // 【【【核心修改】】】使用新函数来隐藏
            hideWithTransition(coupleStatusContextMenu, 'visible');
        }
    });

    // ===================================================================
    // 【【【全新 V3.9】】】添加状态弹窗事件监听
    // ===================================================================

    // 监听“添加状态”弹窗内的各种点击事件
    if (addStatusModal) {
        // 点击下拉框头部，展开/收起列表
        statusDropdownHeader.addEventListener('click', () => {
            statusDropdownContainer.classList.toggle('expanded');
        });

        // 事件委托：点击下拉列表中的某个选项
        statusDropdownList.addEventListener('click', (e) => {
            const item = e.target.closest('.status-dropdown-item');
            if (!item) return;

            const optionId = item.dataset.id;
            const selectedOption = statusOptions.find(opt => opt.id === optionId);

            if (selectedOption) {
                // 暂存选择的数据
                currentStatusData.id = selectedOption.id;
                currentStatusData.svg = selectedOption.svg;

                // 更新下拉框头部的显示
                const selectedIconDiv = statusDropdownHeader.querySelector('.status-dropdown-selected-icon');
                const selectedTextSpan = statusDropdownHeader.querySelector('.status-dropdown-selected-text');
                selectedIconDiv.innerHTML = selectedOption.svg;
                selectedTextSpan.textContent = selectedOption.text;

                // 自动将模板文字填充到内容框
                statusContentInput.value = selectedOption.text;

                // 关闭下拉列表
                statusDropdownContainer.classList.remove('expanded');
            }
        });

        // 点击“自己/AI”选择器
        statusSubjectSelector.addEventListener('click', () => {
            if (currentStatusData.subject === 'user') {
                currentStatusData.subject = 'assistant';
                statusSubjectSelector.textContent = 'AI';
            } else {
                currentStatusData.subject = 'user';
                statusSubjectSelector.textContent = '自己';
            }
        });

        // 点击关闭和取消按钮
        addStatusCloseBtn.addEventListener('click', () => addStatusModal.classList.remove('visible'));
        addStatusCancelBtn.addEventListener('click', () => addStatusModal.classList.remove('visible'));

        // 点击保存按钮
        addStatusSaveBtn.addEventListener('click', saveNewStatusMessage);
    }

    // 点击页面其他地方，如果下拉框是展开的，就收起它
    document.body.addEventListener('click', (e) => {
        if (statusDropdownContainer.classList.contains('expanded') && !statusDropdownContainer.contains(e.target)) {
            statusDropdownContainer.classList.remove('expanded');
        }
    });
    // ===================================================================
    // 【【【全新 V3.8.4】】】动态评论核心事件监听
    // ===================================================================
    const statusFeedContainer = document.getElementById('couple-status-feed');
    if (statusFeedContainer) {
        statusFeedContainer.addEventListener('click', (e) => {
            const sendBtn = e.target.closest('.status-post-comment-send');
            const deleteCommentBtn = e.target.closest('.comment-delete-btn');

            // --- 逻辑1: 点击发送评论 ---
            if (sendBtn) {
                const commentArea = sendBtn.closest('.status-post-comment-area');
                const statusId = commentArea.dataset.statusId;
                const input = commentArea.querySelector('.status-post-comment-input');
                const content = input.value.trim();

                if (!content) {
                    alert('评论内容不能为空哦！');
                    return;
                }

                const statusToUpdate = coupleSpaceSettings.statuses.find(s => s.id === statusId);
                if (statusToUpdate) {
                    // 获取评论人名字
                    const partnerChat = chats.find(c => c.id === coupleSpaceSettings.partnerChatId);
                    const commenterName = (partnerChat && partnerChat.settings.userName) ? partnerChat.settings.userName : '我';

                    const newComment = {
                        id: 'comment_' + Date.now() + Math.random(), // 唯一的评论ID
                        commenterName: commenterName,
                        content: content,
                        timestamp: Date.now()
                    };

                    // 如果statuses对象上还没有comments数组，就创建一个
                    if (!statusToUpdate.comments) {
                        statusToUpdate.comments = [];
                    }
                    statusToUpdate.comments.push(newComment);

                    saveCoupleSpaceSettings();
                    renderStatusFeed();
                }
            }

            // --- 逻辑2: 点击删除评论 ---
            if (deleteCommentBtn) {
                const statusId = deleteCommentBtn.dataset.statusId;
                const commentId = deleteCommentBtn.dataset.commentId;

                showConfirmationModal('确定要删除这条评论吗？', () => {
                    const statusToUpdate = coupleSpaceSettings.statuses.find(s => s.id === statusId);
                    if (statusToUpdate && statusToUpdate.comments) {
                        // 过滤掉要删除的评论
                        statusToUpdate.comments = statusToUpdate.comments.filter(c => c.id !== commentId);

                        saveCoupleSpaceSettings();
                        renderStatusFeed();
                    }
                });
            }
        });
    }

    // ===================================================================
    // 【【【在这里新增下面的代码】】】
    // ===================================================================
    // 【新增】监听来自 Service Worker 的消息
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', event => {
            // 检查是不是“打开聊天”的指令
            if (event.data && event.data.type === 'OPEN_CHAT') {
                const chatIdToOpen = event.data.chatId;
                console.log('收到来自 Service Worker 的指令，打开聊天:', chatIdToOpen);

                // 确保应用已完全加载
                // 如果 chats 数组已经加载，就直接打开
                if (window.chats && window.chats.length > 0) {
                    openChat(chatIdToOpen);
                } else {
                    // 如果应用还没完全初始化好，就先记下来，等初始化完再打开
                    document.addEventListener('appInitialized', () => {
                        openChat(chatIdToOpen);
                    }, { once: true });
                }
            }
        });
    }
    // 启动应用
    initializeApp();
});
