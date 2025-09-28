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

// 在后台更新数据并显示通知 (修复版)
async function updateDataAndShowNotification(chatId, replyActions) {
    let chats = await db.get('chats') || [];
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;

    let firstValidNotificationBody = '';
    let messageCount = 0;

    for (const action of replyActions) {
        const aiMessageBase = {
            id: 'msg_' + Date.now() + Math.random() + messageCount,
            role: 'assistant',
            timestamp: Date.now() + messageCount
        };

        let messageToAppend = { ...aiMessageBase, type: action.type };

        // 【【【核心修复逻辑】】】
        let currentMessageBody = '';
        switch (action.type) {
            case 'text':
                messageToAppend.content = action.content;
                currentMessageBody = action.content;
                break;
            case 'sticker':
                messageToAppend.content = action.url;
                messageToAppend.meaning = action.name; // AI返回的是name
                currentMessageBody = `[表情] ${action.name || ''}`;
                break;
            case 'couple_request':
                messageToAppend.statusType = 'ai-sends-invite';
                messageToAppend.isActionable = true;
                currentMessageBody = `[情侣空间消息] ${chat.settings.aiName || chat.name} 想和你建立情侣关系`;
                break;
            // 在这里可以补充其他 action 类型的处理
            default:
                messageToAppend.content = '[复合消息]';
                currentMessageBody = '[你收到一条新消息]';
                break;
        }

        // 只将第一条有意义的内容作为通知正文
        if (!firstValidNotificationBody && currentMessageBody) {
            firstValidNotificationBody = currentMessageBody;
        }

        chat.history.push(messageToAppend);
        messageCount++;
    }

    chat.unreadCount = (chat.unreadCount || 0) + messageCount;

    await db.set('chats', chats);
    console.log(`数据库已在后台更新！新增 ${messageCount} 条消息, 未读数: ${chat.unreadCount}`);

    const title = chat.settings.aiName || chat.name;
    const icon = chat.settings.aiAvatar || './icon-192x192.png';

    // 【【【安全保障】】】确保通知内容永远不会是空的或 undefined
    const finalBody = firstValidNotificationBody || (messageCount > 1 ? `你收到了 ${messageCount} 条新消息` : '你收到一条新消息');

    self.registration.showNotification(title, {
        body: finalBody,
        icon: icon,
        badge: icon,
        tag: `chat-${chatId}`
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