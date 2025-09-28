// service-worker.js - 真正具备后台工作能力的新版本

// IndexedDB 数据库帮助函数 (必须在 Service Worker 中也定义一份)
const db = {
    _db: null,
    _dbName: 'KikiChatDB',
    _storeName: 'kv_store',
    async _getDB() {
        if (this._db) return this._db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this._dbName, 1);
            request.onerror = () => reject("Error opening db in SW");
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
    }
};

// 监听来自页面的消息，这里是所有任务的入口
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'FETCH_AI_REPLY') {
        // 当收到生成AI回复的任务时，开始执行
        event.waitUntil(handleAiFetchAndNotify(event.data.payload));
    }
});

// 核心功能：获取AI回复并根据情况通知或回传消息
async function handleAiFetchAndNotify(payload) {
    const { chatId, messagesForApi, apiSettings } = payload;
    const { baseUrl, apiKey, modelName } = apiSettings;

    try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: modelName,
                messages: messagesForApi
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: response.statusText } }));
            throw new Error(errorData.error.message || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const aiReplyString = data.choices[0].message.content;
        const replyActions = parseAiJsonResponse(aiReplyString);

        // 获取所有已打开的窗口/标签页
        const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

        let isPageVisibleAndActive = false;
        // 检查是否有任何一个窗口是可见的并且是当前聊天的窗口
        for (const client of clientsArr) {
            // client.visibilityState === 'visible' 检查标签页是否在前台
            // client.url.includes('kikovo77.github.io') 确保是你的应用
            if (client.visibilityState === 'visible' && client.url.includes('kikovo77.github.io')) {
                // 向页面发送一个消息，询问它当前是否在正确的聊天窗口
                const response = await new Promise(resolve => {
                    const channel = new MessageChannel();
                    channel.port1.onmessage = (event) => resolve(event.data);
                    client.postMessage({ type: 'IS_CHAT_ACTIVE', chatId: chatId }, [channel.port2]);
                });
                if (response && response.isActive) {
                    isPageVisibleAndActive = true;
                    // 如果页面可见且激活，就把消息回传给这个页面
                    client.postMessage({ type: 'NEW_AI_MESSAGES', payload: { chatId, replyActions } });
                    break; // 找到一个激活的就够了
                }
            }
        }

        // 如果没有任何一个页面是可见且激活的，就显示系统通知
        if (!isPageVisibleAndActive) {
            console.log('页面在后台，准备显示通知并更新数据库...');
            await updateDataAndShowNotification(chatId, replyActions);
        }

    } catch (error) {
        console.error('Service Worker Fetch Error:', error);
        // 可以在这里也发一个错误通知
        self.registration.showNotification('KikiPhone', {
            body: `获取回复失败: ${error.message}`,
            icon: './icon-192x192.png'
        });
    }
}

// 在后台更新数据并显示通知
async function updateDataAndShowNotification(chatId, replyActions) {
    // 1. 从 IndexedDB 读取最新的 chats 数据
    let chats = await db.get('chats') || [];
    const chat = chats.find(c => c.id === chatId);

    if (!chat) return;

    // 2. 将 AI 的回复添加到聊天记录中
    let notificationBody = '';
    let messageCount = 0;

    for (const action of replyActions) {
        const aiMessageBase = {
            id: 'msg_' + Date.now() + Math.random() + messageCount,
            role: 'assistant',
            timestamp: Date.now() + messageCount // 确保时间戳不完全一样
        };
        let messageToAppend = { ...aiMessageBase, content: action.content || '[消息]', type: action.type, meaning: action.meaning };

        // 简化处理，只处理文本和表情
        if (action.type === 'text') {
            messageToAppend.content = action.content;
            if (!notificationBody) notificationBody = action.content; // 将第一条文本作为通知内容
        } else if (action.type === 'sticker') {
            messageToAppend.content = action.url;
            if (!notificationBody) notificationBody = `[表情] ${action.name || ''}`;
        } else {
            messageToAppend.content = '[复合消息]';
            if (!notificationBody) notificationBody = '[你收到一条新消息]';
        }

        chat.history.push(messageToAppend);
        messageCount++;
    }

    // 3. 更新未读数
    chat.unreadCount = (chat.unreadCount || 0) + messageCount;

    // 4. 将更新后的 chats 数据写回 IndexedDB
    await db.set('chats', chats);
    console.log('数据库已在后台更新！');

    // 5. 显示通知
    const title = chat.settings.aiName || chat.name;
    const icon = chat.settings.aiAvatar || './icon-192x192.png'; // 确保你有一个默认图标

    self.registration.showNotification(title, {
        body: notificationBody,
        icon: icon,
        badge: icon,
        tag: `chat-${chatId}` // 使用聊天ID作为标签，防止同一聊天的通知刷屏
    });
}

// 监听通知点击事件 (保持不变)
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            if (clientList.length > 0) {
                let client = clientList[0];
                for (let i = 0; i < clientList.length; i++) {
                    if (clientList[i].focused) {
                        client = clientList[i];
                    }
                }
                return client.focus();
            }
            return clients.openWindow('/');
        })
    );
});

// JSON 解析器 (保持不变)
function parseAiJsonResponse(jsonString) {
    let text = jsonString.trim();
    text = text.replace(/^```json\s*/, '').replace(/```$/, '').trim();
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
    } catch (e) { }
    const jsonObjects = text.match(/{[^{}]*:[^}]*}/g);
    if (jsonObjects) {
        const results = [];
        jsonObjects.forEach(objStr => {
            try { results.push(JSON.parse(objStr)); } catch (e) { }
        });
        if (results.length > 0) return results;
    }
    return [{ type: 'text', content: jsonString }];
}