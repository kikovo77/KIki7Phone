// service-worker.js - 真正具备后台工作能力的新版本

// --- 1. 门房的“档案室管理员”：IndexedDB 数据库助手 ---
// (必须在 Service Worker 中也定义一份，因为它独立工作)
const db = {
    _db: null,
    _dbName: 'KikiChatDB',
    _storeName: 'kv_store',

    async _getDB() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this._dbName, 1);
            request.onerror = (event) => reject("Error opening db in SW: " + event.target.error);
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
            request.onerror = (e) => reject("Error setting value in SW: " + e.target.error);
        });
    },
};

// --- 2. 门房的“工作启动”仪式 ---
self.addEventListener('install', (event) => {
    // 强制新的 Service Worker 立即取代旧的，确保更新后马上生效
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    // 确保新的 Service Worker 激活后立即开始控制所有打开的页面
    event.waitUntil(self.clients.claim());
});


// --- 3. 门房的“主要任务监听器”：接收来自管家的任务 ---
self.addEventListener('message', (event) => {
    // 检查收到的任务是不是“请求AI回复”
    if (event.data && event.data.type === 'FETCH_AI_REPLY') {
        // 如果是，就开始执行“联系AI并通知”的完整流程
        event.waitUntil(handleAiFetchAndNotify(event.data.payload));
    }
});

// --- 4. 核心功能：联系AI、处理回复、并决定如何通知 ---
async function handleAiFetchAndNotify(payload) {
    const { chatId, messagesForApi, apiSettings, isPageVisible } = payload;
    const { baseUrl, apiKey, modelName } = apiSettings;

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: modelName,
                messages: messagesForApi,
            }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: `HTTP error! status: ${response.status}` } }));
            throw new Error(errorData.error.message);
        }

        const data = await response.json();
        const aiReplyString = data.choices[0].message.content;

        // 使用一个更健壮的解析器来处理AI可能返回的不标准JSON
        const replyActions = parseAiJsonResponse(aiReplyString);

        // 如果页面在前台（用户正在看），就通过“内部广播”把结果告诉管家
        if (isPageVisible) {
            const channel = new BroadcastChannel('kiki-chat-updates');
            channel.postMessage({ type: 'NEW_MESSAGES', chatId, replyActions });
            channel.close();
        } else {
            // 如果页面在后台，就由门房自己处理数据更新和弹窗通知
            await updateDataAndShowNotification(chatId, replyActions);
        }

    } catch (error) {
        console.error('Service Worker Fetch Error:', error);
        // 如果后台请求失败，也弹出一个通知告诉用户
        self.registration.showNotification('KikiPhone', {
            body: `获取回复失败: ${error.message}`,
            icon: 'https://tc-new.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250912/I4Xl/1206X1501/IMG_6556.jpeg/webp'
        });
    }
}


// --- 5. 后台数据处理与弹窗显示的核心函数 ---
async function updateDataAndShowNotification(chatId, replyActions) {
    let chats = await db.get('chats') || [];
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    let firstValidNotificationBody = '';
    let messageCount = 0;

    for (const action of replyActions) {
        messageCount++;
        const aiMessageBase = {
            id: 'msg_' + Date.now() + Math.random() + messageCount,
            role: 'assistant',
            timestamp: Date.now()
        };

        let messageToAppend = null;
        let currentMessageBody = ''; // 用于当前消息的通知文本

        switch (action.type) {
            case 'text':
                messageToAppend = { ...aiMessageBase, content: action.content, type: 'text' };
                currentMessageBody = action.content;
                break;
            case 'sticker':
                messageToAppend = { ...aiMessageBase, content: action.url, type: 'sticker', meaning: action.name };
                currentMessageBody = `[表情: ${action.name}]`;
                break;
            // 在这里可以扩展其他后台能处理的动作类型
            default:
                // 对于无法直接显示为通知的动作类型，我们给一个通用提示
                currentMessageBody = '[收到一条消息]';
                // 同时也要把这个动作存到历史记录里
                messageToAppend = { ...aiMessageBase, type: action.type, content: JSON.stringify(action) }; // 将未知动作内容序列化保存
                break;
        }

        // 如果这是我们找到的第一条有效通知内容，就记录下来
        if (currentMessageBody && !firstValidNotificationBody) {
            firstValidNotificationBody = currentMessageBody;
        }

        if (messageToAppend) {
            chat.history.push(messageToAppend);
        }
    }

    // 更新未读计数
    chat.unreadCount = (chat.unreadCount || 0) + messageCount;

    // 将更新后的聊天数据保存回数据库
    await db.set('chats', chats);
    console.log(`[后台] 已为 ${chat.name} 保存 ${messageCount} 条新消息, 未读总数: ${chat.unreadCount}`);

    // 准备并显示通知
    const title = `来自 ${chat.settings.aiName || chat.name}`;
    const icon = chat.settings.aiAvatar || 'https://tc-new.z.wiki/autoupload/f/6Acfaf5snU3W5EM9A3dcliMqqis0rwPOdE2pkJCFqrWyl5f0KlZfm6UsKj-HyTuv/20250912/I4Xl/1206X1501/IMG_6556.jpeg/webp';
    const body = messageCount > 1 ? `你收到了 ${messageCount} 条新消息` : firstValidNotificationBody || '你收到了一条新消息';

    // 使用 tag 可以让同一个聊天的多条通知聚合在一起，而不是刷屏
    const tag = `chat-${chatId}`;

    await self.registration.showNotification(title, { body, icon, tag });
}

// --- 6. 门房的“迎宾”功能：处理通知点击事件 ---
self.addEventListener('notificationclick', (event) => {
    event.notification.close(); // 用户点击后，先关闭通知

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // 检查是否已经有一个窗口打开了
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    // 优先聚焦已经可见的窗口
                    if (clientList[i].visibilityState === 'visible') {
                        client = clientList[i];
                        break;
                    }
                }
                // 如果找到了窗口，就把它切换到前台
                if (client) {
                    client.focus();
                    // 【新增】通过广播通知页面，用户点击了通知，应该立即跳转到对应的聊天
                    const channel = new BroadcastChannel('kiki-chat-updates');
                    channel.postMessage({ type: 'NOTIFICATION_CLICKED', chatId: event.notification.tag.replace('chat-', '') });
                    channel.close();
                }

            } else {
                // 如果没有窗口打开，就尝试打开一个新的
                self.clients.openWindow('/');
            }
        })
    );
});


// --- 7. 一个更健壮的、能容错的AI JSON响应解析器 ---
function parseAiJsonResponse(jsonString) {
    let text = jsonString.trim();
    text = text.replace(/^```json\s*/, '').replace(/```$/, '').trim();

    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
    } catch (e) {
        // 解析失败，继续尝试救援
    }

    const jsonObjects = text.match(/{[^{}]*:[^}]*}/g);
    if (jsonObjects) {
        const results = [];
        jsonObjects.forEach(objStr => {
            try {
                results.push(JSON.parse(objStr));
            } catch (e) {
                console.warn('SW: Skipping unparseable JSON snippet:', objStr);
            }
        });
        if (results.length > 0) return results;
    }

    console.error("SW: All JSON parsing strategies failed! Treating as plain text. Original response:", jsonString);
    return [{ type: 'text', content: jsonString }];
}